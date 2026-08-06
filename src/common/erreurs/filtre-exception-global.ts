import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { CodeErreur, ReponseErreur } from './reponse-erreur';

/** Code postgres d'une violation de contrainte d'unicité. */
const VIOLATION_UNICITE = '23505';

/**
 * Traduit toute exception en une réponse de forme constante.
 *
 * Deux principes :
 * - **Rien ne fuit.** Ni trace d'exécution, ni requête SQL, ni chemin de
 *   fichier ne parvient au client. Le détail complet part dans les journaux
 *   serveur, relié par un identifiant de corrélation.
 * - **Fermé par défaut.** Une exception non reconnue devient un 500 générique
 *   plutôt que d'exposer son message, qui peut contenir n'importe quoi.
 */
@Catch()
export class FiltreExceptionGlobal implements ExceptionFilter {
  private readonly logger = new Logger(FiltreExceptionGlobal.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const contexte = host.switchToHttp();
    const reponse = contexte.getResponse<Response>();
    const requete = contexte.getRequest<Request>();
    const identifiantCorrelation = randomUUID();

    const { statut, corps } = this.traduire(exception, identifiantCorrelation);

    this.journaliser(exception, statut, requete, identifiantCorrelation);

    reponse.status(statut).json({
      ...corps,
      horodatage: new Date().toISOString(),
      chemin: requete.url,
      identifiantCorrelation,
    } satisfies ReponseErreur);
  }

  private traduire(
    exception: unknown,
    identifiantCorrelation: string,
  ): {
    statut: HttpStatus;
    corps: Omit<
      ReponseErreur,
      'horodatage' | 'chemin' | 'identifiantCorrelation'
    >;
  } {
    if (exception instanceof HttpException) {
      return this.traduireHttp(exception);
    }

    // Une contrainte d'unicité violée est une erreur d'usage, pas une panne.
    // Le message postgres nomme la contrainte et parfois la valeur : on ne le
    // transmet pas.
    if (exception instanceof QueryFailedError) {
      const code = (exception as QueryFailedError & { code?: string }).code;
      if (code === VIOLATION_UNICITE) {
        return {
          statut: HttpStatus.CONFLICT,
          corps: {
            code: CodeErreur.CONFLIT,
            message: 'Cette ressource existe déjà.',
          },
        };
      }
    }

    return {
      statut: HttpStatus.INTERNAL_SERVER_ERROR,
      corps: {
        code: CodeErreur.ERREUR_INTERNE,
        message: `Une erreur interne est survenue. Communiquez la référence ${identifiantCorrelation} au support.`,
      },
    };
  }

  private traduireHttp(exception: HttpException): {
    statut: HttpStatus;
    corps: Omit<
      ReponseErreur,
      'horodatage' | 'chemin' | 'identifiantCorrelation'
    >;
  } {
    // getStatus() renvoie un number : le typer en HttpStatus permet les
    // comparaisons d'énumération sans avertissement.
    const statut: HttpStatus = exception.getStatus();
    const contenu = exception.getResponse();

    // Le ValidationPipe produit un tableau de messages : on le restructure par
    // champ, pour que le frontend puisse afficher l'erreur au bon endroit.
    if (
      statut === HttpStatus.BAD_REQUEST &&
      this.estErreurDeValidation(contenu)
    ) {
      return {
        statut,
        corps: {
          code: CodeErreur.VALIDATION,
          message: 'Certains champs sont invalides.',
          champs: this.regrouperParChamp(contenu.message),
        },
      };
    }

    return {
      statut,
      corps: {
        code: this.codeDepuisStatut(statut),
        message: this.messageDepuisContenu(contenu, statut),
      },
    };
  }

  private estErreurDeValidation(
    contenu: unknown,
  ): contenu is { message: string[] } {
    return (
      typeof contenu === 'object' &&
      contenu !== null &&
      Array.isArray((contenu as { message?: unknown }).message)
    );
  }

  /**
   * `class-validator` renvoie des phrases préfixées du nom du champ, par
   * exemple « email must be an email ». On les regroupe par champ.
   */
  private regrouperParChamp(messages: string[]): Record<string, string[]> {
    return messages.reduce<Record<string, string[]>>((acc, message) => {
      const champ = message.split(' ')[0] || 'inconnu';
      acc[champ] ??= [];
      acc[champ].push(message);
      return acc;
    }, {});
  }

  private messageDepuisContenu(contenu: unknown, statut: HttpStatus): string {
    if (typeof contenu === 'string') {
      return contenu;
    }
    if (
      typeof contenu === 'object' &&
      contenu !== null &&
      typeof (contenu as { message?: unknown }).message === 'string'
    ) {
      return (contenu as { message: string }).message;
    }
    return this.messageParDefaut(statut);
  }

  private codeDepuisStatut(statut: HttpStatus): string {
    switch (statut) {
      case HttpStatus.UNAUTHORIZED:
        return CodeErreur.NON_AUTHENTIFIE;
      case HttpStatus.FORBIDDEN:
        return CodeErreur.ACCES_REFUSE;
      case HttpStatus.NOT_FOUND:
        return CodeErreur.INTROUVABLE;
      case HttpStatus.CONFLICT:
        return CodeErreur.CONFLIT;
      case HttpStatus.TOO_MANY_REQUESTS:
        return CodeErreur.TROP_DE_REQUETES;
      case HttpStatus.BAD_REQUEST:
        return CodeErreur.VALIDATION;
      default:
        return CodeErreur.ERREUR_INTERNE;
    }
  }

  private messageParDefaut(statut: HttpStatus): string {
    return statut >= HttpStatus.INTERNAL_SERVER_ERROR
      ? 'Une erreur interne est survenue.'
      : 'La requête n’a pas pu être traitée.';
  }

  private journaliser(
    exception: unknown,
    statut: HttpStatus,
    requete: Request,
    identifiantCorrelation: string,
  ): void {
    const contexte = `${requete.method} ${requete.url} [${identifiantCorrelation}]`;

    // Seules les erreurs serveur méritent une trace complète : un 404 ou un 401
    // sont des situations normales, les journaliser en erreur noierait le signal.
    if (statut >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        contexte,
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    this.logger.warn(
      `${contexte} -> ${statut}${
        exception instanceof HttpException ? ` (${exception.message})` : ''
      }`,
    );
  }
}
