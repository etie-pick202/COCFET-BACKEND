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

  /**
   * Page de paiement a ouvrir, quand le prestataire en impose une.
   *
   * Nulle en paiement direct : la demande part sur le telephone du payeur sans
   * page intermediaire. Non nulle, le client doit y envoyer le payeur, sans
   * quoi le reglement reste impossible.
   *
   * **Effacee des que le paiement est tranche.** Un lien conserve apres coup
   * n'a plus d'usage, et laisser un moyen de payer ce qui est deja regle ou
   * refuse ne peut produire qu'une confusion.
   */
  @Column({ name: 'url_paiement', type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  urlPaiement: string | null;

  /**
   * Qui a valide ce billet a l'entree.
   *
   * « scannedAt » disait quand, jamais par qui : impossible de savoir qui
   * avait laisse entrer quelqu'un. Le couple des deux rend le passage
   * rattachable a son portier.
   *
   * **Efface au bout d'une semaine** par la purge : la trace d'un controle a
   * une utilite courte, et la conserver au-dela ferait de la billetterie un
   * fichier de presence.
   *
   * « SET NULL » : le depart d'un portier ne doit pas emporter les billets
   * qu'il a valides.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'scanne_par_id' })
  @ApiProperty({ type: () => User, nullable: true })
  scannePar: User | null;
}
