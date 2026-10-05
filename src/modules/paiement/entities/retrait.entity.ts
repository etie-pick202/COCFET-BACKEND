import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { StatutRetrait } from '../enums/paiement.enum';

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

  @Column({ name: 'initie_le', type: 'timestamptz' })
  @ApiProperty({ format: 'date-time' })
  initieLe: Date;

  @Column({ name: 'confirme_le', type: 'timestamptz', nullable: true })
  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  confirmeLe: Date | null;

  /** Explication saisie par le bureau. Jamais écrasée par la synchronisation. */
  @Column({ type: 'text', nullable: true })
  @ApiPropertyOptional({ nullable: true })
  note: string | null;
}
