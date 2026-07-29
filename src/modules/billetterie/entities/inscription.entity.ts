import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import {
  MethodePaiement,
  StatutPaiement,
} from '../../paiement/enums/paiement.enum';
import { Evenement } from '../../evenement/entities/evenement.entity';
import { User } from '../../user/entities/user.entity';

export enum StatutInscription {
  EN_ATTENTE = 'EN_ATTENTE',
  CONFIRMEE = 'CONFIRMEE',
  /** Billet scanné à l'entrée : ne peut plus être réutilisé. */
  UTILISEE = 'UTILISEE',
  ANNULEE = 'ANNULEE',
}

/** Inscription à un événement, matérialisée par un billet à QR code. */
@Entity('inscriptions')
export class Inscription extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Evenement, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'evenement_id' })
  evenement: Evenement;

  @Index({ unique: true })
  @Column({ name: 'code_billet' })
  codeBillet: string;

  @Column({ name: 'qr_code', type: 'text', nullable: true })
  qrCode: string | null;

  @Column({
    type: 'enum',
    enum: StatutInscription,
    default: StatutInscription.EN_ATTENTE,
  })
  statut: StatutInscription;

  /** Prix effectivement payé, figé au moment de l'inscription. */
  @Column({ type: 'int', default: 0 })
  prix: number;

  @Column({
    name: 'methode_paiement',
    type: 'enum',
    enum: MethodePaiement,
    nullable: true,
  })
  methodePaiement: MethodePaiement | null;

  @Column({
    name: 'statut_paiement',
    type: 'enum',
    enum: StatutPaiement,
    default: StatutPaiement.EN_ATTENTE,
  })
  statutPaiement: StatutPaiement;

  @Column({ name: 'scanned_at', type: 'timestamptz', nullable: true })
  scannedAt: Date | null;
}
