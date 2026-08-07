import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({ required: false })
  user: User;

  @ManyToOne(() => Evenement, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'evenement_id' })
  @ApiProperty({ required: false })
  evenement: Evenement;

  @Index({ unique: true })
  @Column({ name: 'code_billet' })
  @ApiProperty()
  codeBillet: string;

  @Column({ name: 'qr_code', type: 'text', nullable: true })
  @ApiProperty({ nullable: true })
  qrCode: string | null;

  @Column({
    type: 'enum',
    enum: StatutInscription,
    default: StatutInscription.EN_ATTENTE,
  })
  @ApiProperty({ enum: StatutInscription })
  statut: StatutInscription;

  /** Prix effectivement payé, figé au moment de l'inscription. */
  @Column({ type: 'int', default: 0 })
  @ApiProperty()
  prix: number;

  @Column({
    name: 'methode_paiement',
    type: 'enum',
    enum: MethodePaiement,
    nullable: true,
  })
  @ApiProperty({ enum: MethodePaiement, nullable: true })
  methodePaiement: MethodePaiement | null;

  @Column({
    name: 'statut_paiement',
    type: 'enum',
    enum: StatutPaiement,
    default: StatutPaiement.EN_ATTENTE,
  })
  @ApiProperty({ enum: StatutPaiement })
  statutPaiement: StatutPaiement;

  @Column({ name: 'scanned_at', type: 'timestamptz', nullable: true })
  @ApiProperty({ nullable: true, format: 'date-time' })
  scannedAt: Date | null;
}
