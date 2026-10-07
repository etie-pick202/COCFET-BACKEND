import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { SourceRetrait, StatutRetrait } from '../enums/paiement.enum';

/**
 * Sortie d'argent du solde, relevée chez le prestataire.
 *
 * Un retrait se fait dans l'espace de Fapshi, hors de cette application : on
 * ne le crée pas, on le **relit**. Chaque ligne est donc le reflet d'une
 * transaction de type « payout » de Fapshi, rapprochée par son identifiant.
 * `note` est la seule colonne qui nous appartient : le bureau y consigne le
 * motif (« remboursement fournisseur », « avance traiteur »), parce que
 * Fapshi n'en garde pas toujours et que la trésorerie doit pouvoir expliquer
 * chaque sortie.
 */
@Entity('retraits')
export class Retrait extends BaseEntity {
  /** Identifiant de la transaction chez Fapshi : clé de rapprochement. */
  @Index({ unique: true })
  @Column({ name: 'reference_externe' })
  @ApiProperty()
  referenceExterne: string;

  /** En FCFA. */
  @Column({ type: 'int' })
  @ApiProperty()
  montant: number;

  @Column({
    type: 'enum',
    enum: StatutRetrait,
    default: StatutRetrait.EN_COURS,
  })
  @ApiProperty({ enum: StatutRetrait })
  statut: StatutRetrait;

  @Column({
    type: 'enum',
    enum: SourceRetrait,
    default: SourceRetrait.FAPSHI,
  })
  @ApiProperty({
    enum: SourceRetrait,
    description:
      '`FAPSHI` : retrait relevé chez Fapshi. `CONSTATEE` : baisse du solde ' +
      'que rien n’explique, constatée par l’application ; le détail est dans ' +
      'l’espace de Fapshi.',
  })
  source: SourceRetrait;

  @Column({ type: 'varchar', nullable: true })
  @ApiPropertyOptional({ nullable: true })
  operateur: string | null;

  @Column({ type: 'varchar', nullable: true })
  @ApiPropertyOptional({ nullable: true })
  beneficiaire: string | null;

  /** Motif tel que Fapshi l'a conservé, quand il existe. */
  @Column({ type: 'varchar', nullable: true })
  @ApiPropertyOptional({ nullable: true })
  motif: string | null;

  /** Référence de l'opérateur Mobile Money, une fois le retrait abouti. */
  @Column({ name: 'reference_financiere', type: 'varchar', nullable: true })
  @ApiPropertyOptional({ nullable: true })
  referenceFinanciere: string | null;

  /**
   * Retrait : date d'initiation chez Fapshi. Sortie constatée : première
   * lecture où la baisse a été vue.
   */
  @Column({ name: 'initie_le', type: 'timestamptz' })
  @ApiProperty({ format: 'date-time' })
  initieLe: Date;

  @Column({ name: 'confirme_le', type: 'timestamptz', nullable: true })
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  confirmeLe: Date | null;

  /**
   * Membre entre les mains de qui l'argent retiré a atterri.
   *
   * Un retrait fait sortir l'argent du compte Fapshi **et** le fait entrer
   * dans la poche de quelqu'un : tant qu'on ne dit pas laquelle, il reste
   * « non attribué » dans le suivi des fonds. `SET NULL` : le départ d'un
   * membre ne doit pas effacer le retrait.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'detenteur_id' })
  detenteur: User | null;

  /** Explication saisie par le bureau. Jamais écrasée par la synchronisation. */
  @Column({ type: 'text', nullable: true })
  @ApiPropertyOptional({ nullable: true })
  note: string | null;
}
