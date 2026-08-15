import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { BilletterieService } from '../billetterie/billetterie.service';
import { CommandeService } from '../commande/commande.service';
import { OrigineTransaction } from './entities/transaction.entity';
import { StatutPaiement } from './enums/paiement.enum';
import { TransactionService } from './transaction.service';
import { CotisationService } from '../cotisation/cotisation.service';

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
    private readonly cotisationService: CotisationService,
    private readonly transactionService: TransactionService,
    private readonly billetterieService: BilletterieService,
    @Inject(forwardRef(() => CommandeService))
    private readonly commandeService: CommandeService,
  ) {}

  async repercuter(reference: string, statut: StatutPaiement): Promise<void> {
    const transaction = await this.transactionService.trouver(reference);

    if (!transaction) {
      this.logger.warn(`Paiement sans transaction connue : ${reference}`);
      return;
    }

    // Une cotisation ne se confirme ni ne s'annule : elle se credite. Il n'y a
    // ni place a liberer ni stock a rendre, seulement un solde qui avance. Un
    // echec n'a donc rien a defaire — la personne devra simplement reessayer.
    if (transaction.origine === OrigineTransaction.COTISATION) {
      if (statut === StatutPaiement.COMPLETE) {
        await this.cotisationService.enregistrerReglement(
          reference,
          transaction.montant,
        );
      }
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
      const motif = 'le paiement a été refusé par l’opérateur.';
      await (boutique
        ? this.commandeService.echouerPaiement(reference, motif)
        : this.billetterieService.echouerPaiement(reference, motif));
    }
  }
}
