import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { Request } from 'express';
import { normaliserEmail } from '../identite/identite-campus';
import { LimiteurMemoire } from './limiteur-memoire';
import {
  LIMITE_DEBIT_KEY,
  OptionsLimiteDebit,
  SANS_LIMITE_DEBIT_KEY,
} from './limite-debit.decorator';

/**
 * Limitation de débit distribuée (Upstash Redis).
 *
 * **Elle refuse de se taire en production.** Sans elle, `/auth/connexion` est
 * une porte ouverte à la force brute et `/auth/inscription` un moyen de vider
 * le quota d'envoi d'emails. Un garde qui se désactive en silence quand sa
 * configuration manque est pire que pas de garde du tout : on se croit
 * protégé. Hors production, l'absence de configuration reste tolérée, pour ne
 * bloquer ni le développement local ni la CI.
 *
 * Deux compteurs jouent sur les routes qui portent une adresse :
 *
 * - **par adresse IP**, qui arrête un attaquant isolé ;
 * - **par adresse email**, qui arrête celui qui change d'IP à chaque essai —
 *   le compteur par IP seul ne verrait alors rien passer.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly redis: Redis | null;
  private readonly defaut: OptionsLimiteDebit;

  /** Un limiteur par plafond distinct, construit à la demande. */
  private readonly limiteurs = new Map<string, Ratelimit>();

  /** Le secours, quand Upstash ne répond plus. */
  private readonly memoire = new LimiteurMemoire();

  /**
   * Jusqu'à quand Upstash est laissé de côté après une erreur. Sans cette
   * pause, chaque requête retenterait un service saturé et paierait son délai
   * de réponse avant de basculer.
   */
  private upstashSuspenduJusqua = 0;

  constructor(
    config: ConfigService,
    private readonly reflector: Reflector,
  ) {
    const url = config.get<string>('UPSTASH_REDIS_REST_URL');
    const token = config.get<string>('UPSTASH_REDIS_REST_TOKEN');

    this.defaut = {
      requetes: Number(config.get<string>('RATE_LIMIT_REQUESTS', '100')),
      fenetreSecondes: Number(
        config.get<string>('RATE_LIMIT_WINDOW_SECONDS', '60'),
      ),
    };

    if (url && token) {
      this.redis = new Redis({ url, token });
      return;
    }

    if (config.get<string>('NODE_ENV') === 'production') {
      throw new Error(
        'UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN sont obligatoires en ' +
          "production : sans limitation de debit, la connexion et l'inscription " +
          "sont exposees a la force brute et a l'envoi massif d'emails.",
      );
    }

    this.logger.warn(
      'Upstash non configure : limitation de debit desactivee (hors production).',
    );
    this.redis = null;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.redis) {
      return true;
    }

    const cibles = [context.getHandler(), context.getClass()];

    if (
      this.reflector.getAllAndOverride<boolean>(SANS_LIMITE_DEBIT_KEY, cibles)
    ) {
      return true;
    }

    const options =
      this.reflector.getAllAndOverride<OptionsLimiteDebit>(
        LIMITE_DEBIT_KEY,
        cibles,
      ) ?? this.defaut;

    const requete = context.switchToHttp().getRequest<Request>();
    // Le compteur est propre à la route : sans cela, consulter la liste des
    // événements consommerait le budget des tentatives de connexion.
    const chemin =
      (requete.route as { path?: string } | undefined)?.path ?? requete.path;
    const route = `${requete.method}:${chemin}`;

    const compteurs = [`ip:${requete.ip ?? 'inconnue'}`];
    const email = this.emailDuCorps(requete);
    if (email) {
      compteurs.push(`email:${email}`);
    }

    for (const compteur of compteurs) {
      const success = await this.autoriser(options, `${route}|${compteur}`);

      if (!success) {
        this.logger.warn(`Plafond atteint sur ${route} (${compteur}).`);
        throw new HttpException(
          'Trop de requêtes, veuillez réessayer plus tard.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    return true;
  }

  /**
   * Interroge Upstash, ou le compteur local quand Upstash fait défaut.
   *
   * Une erreur d'Upstash — le quota mensuel épuisé a mis tout le site à terre
   * le 30 octobre 2026 — ne doit jamais devenir une erreur 500 : la limitation
   * bascule sur la mémoire pendant une minute, puis Upstash est retenté.
   */
  private async autoriser(
    options: OptionsLimiteDebit,
    cle: string,
  ): Promise<boolean> {
    const maintenant = Date.now();

    if (maintenant >= this.upstashSuspenduJusqua) {
      try {
        return (await this.limiteur(options).limit(cle)).success;
      } catch (erreur) {
        this.upstashSuspenduJusqua =
          maintenant + RateLimitGuard.PAUSE_UPSTASH_MS;
        this.logger.error(
          `Upstash injoignable, limitation en mémoire pendant une minute : ${
            erreur instanceof Error ? erreur.message : String(erreur)
          }`,
        );
      }
    }

    return this.memoire.autoriser(
      cle,
      options.requetes,
      options.fenetreSecondes,
      maintenant,
    );
  }

  private static readonly PAUSE_UPSTASH_MS = 60_000;

  private limiteur(options: OptionsLimiteDebit): Ratelimit {
    const cle = `${options.requetes}/${options.fenetreSecondes}`;
    let limiteur = this.limiteurs.get(cle);

    if (!limiteur) {
      limiteur = new Ratelimit({
        redis: this.redis!,
        limiter: Ratelimit.slidingWindow(
          options.requetes,
          `${options.fenetreSecondes} s`,
        ),
        // Désactivées : elles ajoutaient des commandes à chaque requête, et ont
        // contribué à épuiser le quota mensuel d'Upstash.
        analytics: false,
        prefix: 'cocfet',
      });
      this.limiteurs.set(cle, limiteur);
    }

    return limiteur;
  }

  /**
   * Adresse email présente dans le corps, normalisée.
   *
   * Normalisée pour que `E.Mayack+essai@…` et `e.mayack@…` partagent le même
   * compteur : sans cela, varier le suffixe suffirait à repartir d'un budget
   * neuf à chaque tentative.
   */
  private emailDuCorps(requete: Request): string | null {
    const corps = requete.body as { email?: unknown } | undefined;

    return typeof corps?.email === 'string' && corps.email.length <= 254
      ? normaliserEmail(corps.email)
      : null;
  }
}
