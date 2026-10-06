import { Injectable, Logger } from '@nestjs/common';
import { montantLisible } from '../../common/montant';
import { BureauService } from '../bureau/bureau.service';
import { TypeNotification } from './entities/notification.entity';
import { NotificationService } from './notification.service';

/** D'où vient l'argent, dit comme dans l'alerte. */
export type OrigineEncaissement = 'billetterie' | 'boutique' | 'cotisation';

/** Ce qu'il faut pour annoncer un encaissement. */
export interface Encaissement {
  origine: OrigineEncaissement;
  payeur: { id: string; firstName: string; lastName: string };
  /** Ce qui a été payé : « Gala 2027 », « 3 article(s) », « Tranche 1 ». */
  objet: string;
  /** Ce qui a été reçu, en FCFA : le montant crédité, ou le débité en ligne. */
  montant: number;
  /** Part retenue par le prestataire de paiement, quand elle l'a été. */
  fraisPrestataire?: number | null;
}

/** Page de l'administration où se lisent les comptes. */
const PAGE_TRESORERIE = '/admin/finances';

/**
 * Prévient la trésorerie de ce qui entre — et de ce qui attend son verdict.
 *
 * Destinataires : ceux qui ont le droit de lire les comptes (voir
 * `BureauService.destinatairesTresorerie`), pas tout le bureau. Chaque achat,
 * chaque règlement de cotisation, chaque preuve déposée apprend à la
 * trésorerie ce qu'elle a à suivre ou à décider, sans qu'elle ait à ouvrir le
 * tableau de bord pour le découvrir.
 *
 * **Ne lève jamais.** Une alerte est un effet de bord : un paiement reconnu ne
 * doit pas échouer parce qu'un email part mal.
 */
@Injectable()
export class AlerteTresorerieService {
  private readonly logger = new Logger(AlerteTresorerieService.name);

  constructor(
    private readonly bureauService: BureauService,
    private readonly notificationService: NotificationService,
  ) {}

  /** Un paiement vient d'être reçu. */
  encaissement(encaissement: Encaissement): Promise<void> {
    const frais = encaissement.fraisPrestataire ?? 0;
    const net =
      frais > 0
        ? ` Après les frais du prestataire (${montantLisible(frais)}), ` +
          `${montantLisible(encaissement.montant - frais)} arrivent en caisse.`
        : '';

    return this.signaler(
      encaissement.payeur.id,
      `Nouvel encaissement — ${encaissement.origine}`,
      `${nomComplet(encaissement.payeur)} a réglé ${montantLisible(encaissement.montant)} ` +
        `pour ${encaissement.objet}.${net}`,
      'Ouvrir la trésorerie',
    );
  }

  /** Une preuve de paiement attend d'être validée ou refusée. */
  preuveADecider(
    payeur: Encaissement['payeur'],
    objet: string,
    montantDeclare: number,
  ): Promise<void> {
    return this.signaler(
      payeur.id,
      'Preuve de paiement à valider',
      `${nomComplet(payeur)} a déposé une preuve de paiement de ` +
        `${montantLisible(montantDeclare)} pour ${objet}. Elle attend votre décision.`,
      'Examiner la preuve',
    );
  }

  /**
   * @param exclure le payeur lui-même : un trésorier qui règle sa cotisation
   *   n'a pas besoin qu'on lui annonce son propre paiement.
   */
  private async signaler(
    exclure: string,
    titre: string,
    message: string,
    libelleLien: string,
  ): Promise<void> {
    try {
      const destinataires = (
        await this.bureauService.destinatairesTresorerie()
      ).filter((u) => u.id !== exclure);

      if (destinataires.length === 0) {
        return;
      }

      await this.notificationService.notifierPlusieurs(destinataires, {
        type: TypeNotification.PAIEMENT,
        titre,
        message,
        lien: PAGE_TRESORERIE,
        libelleLien,
      });
    } catch (erreur) {
      this.logger.error(
        `Alerte de trésorerie non envoyée (« ${titre} ») : ${(erreur as Error).message}`,
      );
    }
  }
}

function nomComplet(personne: { firstName: string; lastName: string }): string {
  return `${personne.firstName} ${personne.lastName}`.trim();
}
