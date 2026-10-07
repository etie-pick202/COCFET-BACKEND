import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { BilletterieService } from '../billetterie/billetterie.service';
import { CommandeService } from '../commande/commande.service';
import { OrigineTransaction } from './entities/transaction.entity';
import { StatutPaiement } from './enums/paiement.enum';
import { TransactionService } from './transaction.service';
import { CotisationService } from '../cotisation/cotisation.service';
import { FondsService } from '../fonds/fonds.service';

/**
 * Applique au domaine l'issue d'un paiement, d'où qu'elle vienne.
 *
 * Deux chemins mènent ici : la notification du prestataire, et la validation
 * par la trésorerie d'une preuve remise hors ligne. Les deux doivent produire
 * **exactement** les mêmes effets — confirmer la commande ou le billet, rendre
 * le stock ou la place sur un échec. Écrire cet aiguillage deux fois, c'est
 * s'assurer que les deux comportements divergeront un jour, et qu'un paiement
 * reconnu à la main ne délivrera pas le billet que le même paiement en ligne
 * délivre.
 *
 * L'aiguillage repose sur l'**origine** portée par la transaction : une même
 * référence confirme un billet ou une commande, jamais les deux. Sans elle, un
 * paiement de boutique irait chercher un billet qu'il ne trouverait pas, et la
 * commande resterait en attente indéfiniment.
 */
@Injectable()
export class RepercussionPaiementService {
  private readonly logger = new Logger(RepercussionPaiementService.name);

  constructor(
    @Inject(forwardRef(() => CotisationService))
    private readonly cotisationService: CotisationService,
    private readonly transactionService: TransactionService,
    private readonly billetterieService: BilletterieService,
    @Inject(forwardRef(() => CommandeService))
    private readonly commandeService: CommandeService,
    @Inject(forwardRef(() => FondsService))
    private readonly fondsService: FondsService,
  ) {}

  /**
   * @param motif raison d'un échec, transmise à la personne quand elle a un
   *   sens pour elle — le refus d'un justificatif de cotisation, par exemple.
   */
  async repercuter(
    reference: string,
    statut: StatutPaiement,
    motif?: string,
  ): Promise<void> {
    const transaction = await this.transactionService.trouver(reference);

    if (!transaction) {
      this.logger.warn(`Paiement sans transaction connue : ${reference}`);
      return;
    }

    // Une cotisation ne se confirme ni ne s'annule : elle se credite. Il n'y a
    // ni place a liberer ni stock a rendre, seulement un solde qui avance et
    // un reglement dont l'issue est consignee — et annoncee a la personne.
    if (transaction.origine === OrigineTransaction.COTISATION) {
      await this.cotisationService.traiterIssue(transaction, statut, motif);
      return;
    }

    // Un dépôt de membre sur la plateforme n'a ni billet ni commande : il
    // déplace de l'argent d'une poche vers le compte, et rien d'autre.
    if (transaction.origine === OrigineTransaction.REMISE) {
      await this.fondsService.traiterIssue(transaction, statut);
      return;
    }

    const boutique = transaction.origine === OrigineTransaction.BOUTIQUE;

    if (statut === StatutPaiement.COMPLETE) {
      await (boutique
        ? this.commandeService.confirmerPaiement(reference)
        : this.billetterieService.confirmerPaiement(reference));
      return;
    }

    if (statut === StatutPaiement.ECHOUE) {
      const raison = motif ?? 'le paiement a été refusé par l’opérateur.';
      await (boutique
        ? this.commandeService.echouerPaiement(reference, raison)
        : this.billetterieService.echouerPaiement(reference, raison));
    }
  }
}
