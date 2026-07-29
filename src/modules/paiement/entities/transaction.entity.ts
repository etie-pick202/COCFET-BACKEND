import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { MethodePaiement, StatutPaiement } from '../enums/paiement.enum';

export enum OrigineTransaction {
  EVENEMENT = 'EVENEMENT',
  BOUTIQUE = 'BOUTIQUE',
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

  /** Référence du prestataire (NotchPay), sert de clé d'idempotence des webhooks. */
  @Index({ unique: true })
  @Column()
  reference: string;
}
