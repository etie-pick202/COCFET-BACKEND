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

  trouver(reference: string): Promise<Transaction | null> {
    return this.transactions.findOne({
      where: { reference },
      relations: { user: true },
    });
  }
}
