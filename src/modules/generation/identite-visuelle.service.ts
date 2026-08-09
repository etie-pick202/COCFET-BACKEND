import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Stockage } from '../file/ports/stockage';
import { STOCKAGE } from '../file/ports/stockage';
import { GenerationService } from './generation.service';

/**
 * Charte du mandat en cours, prête à être posée sur un document.
 *
 * `logo` porte les **octets**, jamais une URL : c'est ce qui permet de le
 * joindre à un email ou de l'incruster dans un PDF sans dépendre d'un lien
 * qui expire.
 */
export interface IdentiteVisuelle {
  /** Nom du mandat, tel que la plateforme l'affiche. */
  nom: string;
  annee: number | null;
  couleurPrimaire: string;
  couleurSecondaire: string;
  logo: Buffer | null;
}

/** Couleurs de repli, quand aucun mandat n'est actif. */
const CHARTE_NEUTRE = {
  nom: 'COCFET',
  annee: null,
  couleurPrimaire: '#0F172A',
  couleurSecondaire: '#D4AF37',
  logo: null,
} satisfies IdentiteVisuelle;

/** Durée de vie du cache, en millisecondes. */
const DUREE_CACHE = 5 * 60_000;

/**
 * Fournit la charte du bureau à tout ce qui sort de la plateforme.
 *
 * Emails et documents doivent porter le même logo et les mêmes couleurs que
 * le site : un reçu aux couleurs d'un mandat précédent est une incohérence
 * que le destinataire remarque avant nous.
 *
 * **Le résultat est mis en cache.** Sans cela, chaque email déclencherait une
 * requête en base et une lecture du stockage pour un logo qui change une fois
 * par mandat — soit une diffusion à trois cents personnes multipliant par
 * trois cents une lecture strictement identique.
 *
 * Ne lève jamais : une charte indisponible dégrade l'apparence d'un message,
 * elle ne doit pas empêcher son envoi.
 */
@Injectable()
export class IdentiteVisuelleService {
  private readonly logger = new Logger(IdentiteVisuelleService.name);

  private cache: { valeur: IdentiteVisuelle; expire: number } | null = null;

  constructor(
    private readonly generationService: GenerationService,
    @Inject(STOCKAGE) private readonly stockage: Stockage,
  ) {}

  async charte(): Promise<IdentiteVisuelle> {
    if (this.cache && this.cache.expire > Date.now()) {
      return this.cache.valeur;
    }

    const valeur = await this.construire();
    this.cache = { valeur, expire: Date.now() + DUREE_CACHE };

    return valeur;
  }

  /** Vide le cache. À appeler quand le mandat ou son logo changent. */
  invalider(): void {
    this.cache = null;
  }

  private async construire(): Promise<IdentiteVisuelle> {
    let generation: Awaited<ReturnType<GenerationService['trouverActive']>> =
      null;

    try {
      generation = await this.generationService.trouverActive();
    } catch (erreur) {
      this.logger.warn(
        `Charte indisponible, repli sur les couleurs neutres : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
      return CHARTE_NEUTRE;
    }

    if (!generation) {
      // Plateforme fraîchement installée, ou entre deux mandats : les
      // messages doivent partir quand même.
      return CHARTE_NEUTRE;
    }

    return {
      nom: generation.nom,
      annee: generation.annee,
      couleurPrimaire: generation.couleurPrimaire,
      couleurSecondaire: generation.couleurSecondaire,
      logo: await this.lireLogo(generation.logo),
    };
  }

  /**
   * Lit le logo désigné par le mandat.
   *
   * Un échec rend `null` plutôt que de lever : un logo manquant produit un
   * message sans image, ce qui reste préférable à un message jamais envoyé.
   */
  private async lireLogo(cle: string | null): Promise<Buffer | null> {
    if (!cle) {
      return null;
    }

    try {
      return await this.stockage.telecharger(cle);
    } catch (erreur) {
      this.logger.warn(
        `Logo « ${cle} » illisible : les messages partiront sans image. ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
      return null;
    }
  }
}
