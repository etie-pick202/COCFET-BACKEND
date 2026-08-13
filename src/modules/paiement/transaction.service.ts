import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { OrigineTransaction, Transaction } from './entities/transaction.entity';
import { MethodePaiement, StatutPaiement } from './enums/paiement.enum';

export interface OuvertureTransaction {
  reference: string;
  montant: number;
  origine: OrigineTransaction;
  user: User | null;
  methodePaiement: MethodePaiement | null;
}

/**
 * Journal des flux financiers, et **garde-fou d'idempotence** des webhooks.
 *
 * Le prestataire renvoie la même notification plusieurs fois — c'est prévu par
 * son protocole, et c'est ce qui garantit la livraison. Sans dédoublonnage,
 * chaque rejeu rejouerait aussi nos effets de bord : notifications répétées,
 * et demain remboursements ou stock décrémenté deux fois.
 */
@Injectable()
export class TransactionService {
  private readonly logger = new Logger(TransactionService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
  ) {}

  /**
   * Ouvre une transaction, ou renvoie celle qui existe déjà.
   *
   * `orIgnore` s'appuie sur l'index unique de `reference` : deux appels
   * concurrents sur la même référence ne créent qu'une ligne, la seconde
   * insertion étant écartée par la base plutôt que par une lecture préalable.
   */
  async ouvrir(donnees: OuvertureTransaction): Promise<Transaction> {
    await this.transactions
      .createQueryBuilder()
      .insert()
      .into(Transaction)
      .values({
        reference: donnees.reference,
        montant: donnees.montant,
        origine: donnees.origine,
        user: donnees.user,
        methodePaiement: donnees.methodePaiement,
        statut: StatutPaiement.EN_ATTENTE,
      })
      .orIgnore()
      .execute();

    return this.transactions.findOneOrFail({
      where: { reference: donnees.reference },
    });
  }

  /**
   * Enregistre l'état renvoyé par le prestataire.
   *
   * Renvoie `false` quand rien n'a changé — c'est le signal qu'il s'agit d'un
   * rejeu, et que les effets de bord ne doivent **pas** être rejoués.
   *
   * La condition porte sur le statut courant dans la requête elle-même : deux
   * notifications simultanées pour la même référence ne peuvent pas déclencher
   * le traitement toutes les deux.
   */
  async appliquer(reference: string, statut: StatutPaiement): Promise<boolean> {
    const resultat = await this.transactions
      .createQueryBuilder()
      .update(Transaction)
      .set({ statut })
      .where('reference = :reference AND statut != :statut', {
        reference,
        statut,
      })
      .execute();

    const change = resultat.affected === 1;
    if (!change) {
      this.logger.log(
        `Notification déjà traitée pour ${reference} (${statut}) : ignorée.`,
      );
    }

    return change;
  }

  /**
   * Conserve l'identifiant rendu par le prestataire à l'ouverture.
   *
   * Écrit dans un second temps : la transaction est ouverte **avant** l'appel
   * au prestataire, pour qu'un webhook arrivant pendant cet appel trouve une
   * ligne à mettre à jour. L'identifiant n'existe donc pas encore à ce
   * moment-là.
   */
  async enregistrerReferenceExterne(
    reference: string,
    referenceExterne: string,
  ): Promise<void> {
    await this.transactions.update({ reference }, { referenceExterne });
  }

  /**
   * Referme une transaction que le prestataire n'a jamais acceptée.
   *
   * La transaction est ouverte **avant** l'appel au prestataire, pour qu'un
   * webhook arrivant pendant cet appel trouve une ligne à mettre à jour. Quand
   * cet appel échoue, la ligne reste donc `EN_ATTENTE` sans référence
   * prestataire : la réconciliation ne peut ni la vérifier ni la clore, et la
   * signale toutes les cinq minutes, indéfiniment. Ces montants figurent en
   * outre au journal de trésorerie comme des paiements en attente, alors
   * qu'aucun n'a jamais été présenté à l'opérateur.
   *
   * **La condition est étroite, et c'est essentiel.** Seule une transaction
   * encore en attente **et dépourvue de référence prestataire** est refermée.
   * Si le prestataire a rendu un identifiant, le paiement est peut-être en
   * cours sur le téléphone du client : le déclarer échoué ferait perdre un
   * règlement bien réel.
   *
   * Marquée `ECHOUE` plutôt que supprimée : une tentative a eu lieu, et la
   * trace vaut mieux que l'oubli.
   */
  async abandonner(reference: string): Promise<boolean> {
    const resultat = await this.transactions
      .createQueryBuilder()
      .update(Transaction)
      .set({ statut: StatutPaiement.ECHOUE })
      .where(
        'reference = :reference AND statut = :attente AND reference_externe IS NULL',
        { reference, attente: StatutPaiement.EN_ATTENTE },
      )
      .execute();

    const referme = resultat.affected === 1;
    if (referme) {
      this.logger.log(
        `Transaction ${reference} refermée : le prestataire n’a jamais accepté la demande.`,
      );
    }

    return referme;
  }

  /**
   * Transactions restées en attente au-delà d'un délai de grâce.
   *
   * Le délai évite de courir après un webhook qui n'a simplement pas encore
   * eu le temps d'arriver : sans lui, la réconciliation interrogerait le
   * prestataire sur des paiements en cours de validation.
   *
   * Les plus anciennes d'abord, et par lots : ce sont elles qui bloquent une
   * place depuis le plus longtemps, et le prestataire plafonne ses appels.
   */
  enAttenteAvant(limite: Date, taille: number): Promise<Transaction[]> {
    return this.transactions
      .createQueryBuilder('t')
      .where('t.statut = :statut', { statut: StatutPaiement.EN_ATTENTE })
      .andWhere('t.created_at < :limite', { limite })
      .orderBy('t.created_at', 'ASC')
      .take(taille)
      .getMany();
  }

  trouver(reference: string): Promise<Transaction | null> {
    return this.transactions.findOne({
      where: { reference },
      relations: { user: true },
    });
  }
}
