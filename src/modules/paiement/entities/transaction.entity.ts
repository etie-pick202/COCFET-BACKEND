import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { MethodePaiement, StatutPaiement } from '../enums/paiement.enum';

export enum OrigineTransaction {
  EVENEMENT = 'EVENEMENT',
  BOUTIQUE = 'BOUTIQUE',
  COTISATION = 'COTISATION',
}

/**
 * Trace unifiée des flux financiers (billetterie + boutique), utilisée par le
 * dashboard admin et la réconciliation avec le prestataire de paiement.
 */
@Entity('transactions')
export class Transaction extends BaseEntity {
  @Column({ type: 'enum', enum: OrigineTransaction })
  origine: OrigineTransaction;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'int' })
  montant: number;

  @Column({
    type: 'enum',
    enum: StatutPaiement,
    default: StatutPaiement.EN_ATTENTE,
  })
  statut: StatutPaiement;

  @Column({
    name: 'methode_paiement',
    type: 'enum',
    enum: MethodePaiement,
    nullable: true,
  })
  methodePaiement: MethodePaiement | null;

  /** Notre référence — le code du billet. Clé d'idempotence des webhooks. */
  @Index({ unique: true })
  @Column()
  reference: string;

  /**
   * Identifiant de la transaction **chez Fapshi**, renvoyé à l'ouverture.
   *
   * Sans lui, aucune réconciliation n'est possible : `GET /payment-status`
   * s'interroge par cet identifiant, et Fapshi n'offre pas de recherche par
   * notre propre référence. Un paiement dont le webhook se perdrait resterait
   * alors en attente pour toujours, la place bloquée et l'argent débité.
   *
   * Nul tant que le prestataire n'a pas répondu, et sur les transactions
   * ouvertes avant l'existence de cette colonne.
   */
  @Column({ name: 'reference_externe', type: 'varchar', nullable: true })
  referenceExterne: string | null;
}
