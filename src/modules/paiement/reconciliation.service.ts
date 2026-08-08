import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BilletterieService } from '../billetterie/billetterie.service';
import { Transaction } from './entities/transaction.entity';
import { StatutPaiement } from './enums/paiement.enum';
import type { PasserellePaiement } from './ports/passerelle-paiement';
import { PASSERELLE_PAIEMENT } from './ports/passerelle-paiement';
import { TransactionService } from './transaction.service';

/** Transactions examinées par passage. */
const PAR_PASSAGE = 50;

/**
 * Rattrape les paiements dont la notification ne nous est jamais parvenue.
 *
 * En paiement direct, l'appel au prestataire accuse réception sans trancher :
 * **l'issue n'arrive que par webhook**. Un webhook perdu — réseau coupé,
 * redéploiement au mauvais moment, incident chez le prestataire — laisse donc
 * l'inscription en attente pour toujours : l'argent est débité, la place est
 * bloquée, et rien ni personne ne le constate.
 *
 * Cette tâche referme ce trou en posant la question dans l'autre sens : au
 * lieu d'attendre que le prestataire nous parle, elle l'interroge.
 *
 * Deux principes gouvernent le code qui suit :
 *
 * 1. **Le prestataire tranche, jamais nous.** Une transaction n'est déclarée
 *    échue que si Fapshi le dit, ou si elle traîne au-delà du délai *et* que
 *    Fapshi la donne toujours en attente. Conclure hors ligne reviendrait à
 *    annuler un billet peut-être déjà payé.
 * 2. **Une transaction en échec n'arrête pas les autres.** Chacune est
 *    traitée à part : un prestataire injoignable sur l'une ne doit pas priver
 *    les quarante-neuf suivantes de leur rattrapage.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  /**
   * Délai de grâce avant le premier examen, en minutes.
   *
   * Sans lui, la tâche interrogerait le prestataire sur des paiements que
   * l'utilisateur est encore en train de valider sur son téléphone.
   */
  private readonly delaiGrace: number;

  /**
   * Au-delà, une transaction toujours en attente chez le prestataire est
   * considérée comme abandonnée et la place rendue.
   *
   * C'est un arbitrage entre deux torts : trop court, on annule quelqu'un qui
   * cherchait son téléphone ; trop long, une place reste bloquée pour un
   * panier que personne ne réglera.
   */
  private readonly delaiExpiration: number;

  constructor(
    private readonly transactionService: TransactionService,
    @Inject(PASSERELLE_PAIEMENT)
    private readonly passerelle: PasserellePaiement,
    @Inject(forwardRef(() => BilletterieService))
    private readonly billetterieService: BilletterieService,
    config: ConfigService,
  ) {
    this.delaiGrace = config.get<number>('PAIEMENT_DELAI_GRACE_MINUTES', 3);
    this.delaiExpiration = config.get<number>(
      'PAIEMENT_DELAI_EXPIRATION_MINUTES',
      30,
    );
  }

  /**
   * Toutes les cinq minutes : assez souvent pour qu'une place ne reste pas
   * bloquée une demi-heure, assez espacé pour rester loin du plafond de six
   * interrogations par minute et par transaction imposé par Fapshi.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcilier(): Promise<void> {
    const limite = this.ilYA(this.delaiGrace);
    const enAttente = await this.transactionService.enAttenteAvant(
      limite,
      PAR_PASSAGE,
    );

    if (enAttente.length === 0) {
      return;
    }

    this.logger.log(
      `Réconciliation : ${enAttente.length} paiement(s) en attente à vérifier.`,
    );

    for (const transaction of enAttente) {
      await this.traiter(transaction);
    }
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  private async traiter(transaction: Transaction): Promise<void> {
    if (!transaction.referenceExterne) {
      // Ouverte avant que cet identifiant ne soit conservé, ou prestataire
      // n'ayant jamais répondu. Rien à interroger : le signaler vaut mieux
      // que de trancher à l'aveugle, un humain devra regarder.
      this.logger.warn(
        `Transaction ${transaction.reference} sans référence prestataire : ` +
          'réconciliation impossible, à vérifier à la main.',
      );
      return;
    }

    let statut: StatutPaiement;

    try {
      ({ statut } = await this.passerelle.verifier(
        transaction.referenceExterne,
      ));
    } catch (erreur) {
      // Prestataire injoignable ou réponse inattendue : on ne conclut rien et
      // on réessaiera au prochain passage. Déclarer l'échec ici rendrait une
      // place peut-être payée.
      this.logger.error(
        `Vérification impossible pour ${transaction.reference} : ${(erreur as Error).message}`,
      );
      return;
    }

    if (statut === StatutPaiement.COMPLETE) {
      await this.appliquer(transaction, statut, () =>
        this.billetterieService.confirmerPaiement(transaction.reference),
      );
      return;
    }

    if (statut === StatutPaiement.ECHOUE) {
      await this.appliquer(transaction, statut, () =>
        this.billetterieService.echouerPaiement(
          transaction.reference,
          'le paiement a été refusé par l’opérateur.',
        ),
      );
      return;
    }

    // Toujours en attente chez le prestataire : on patiente, sauf si le délai
    // d'abandon est dépassé.
    if (transaction.createdAt < this.ilYA(this.delaiExpiration)) {
      await this.appliquer(transaction, StatutPaiement.ECHOUE, () =>
        this.billetterieService.echouerPaiement(
          transaction.reference,
          `le paiement n’a pas été validé dans les ${this.delaiExpiration} minutes.`,
        ),
      );
    }
  }

  /**
   * Écrit le statut puis déclenche l'effet de bord, dans cet ordre.
   *
   * `appliquer` ne rend `true` qu'à la première transition : si un webhook
   * nous a devancés entre-temps, l'effet de bord ne se rejoue pas, et la
   * place n'est ni rendue ni confirmée deux fois.
   */
  private async appliquer(
    transaction: Transaction,
    statut: StatutPaiement,
    effet: () => Promise<void>,
  ): Promise<void> {
    const change = await this.transactionService.appliquer(
      transaction.reference,
      statut,
    );

    if (!change) {
      return;
    }

    this.logger.log(
      `Réconciliation : ${transaction.reference} passe à ${statut}.`,
    );
    await effet();
  }

  private ilYA(minutes: number): Date {
    return new Date(Date.now() - minutes * 60_000);
  }
}
