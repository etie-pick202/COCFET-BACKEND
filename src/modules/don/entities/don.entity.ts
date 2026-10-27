import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Evenement } from '../../evenement/entities/evenement.entity';
import {
  MethodePaiement,
  StatutPaiement,
} from '../../paiement/enums/paiement.enum';
import { User } from '../../user/entities/user.entity';

export enum TypeDonateur {
  PARTICULIER = 'PARTICULIER',
  ENTREPRISE = 'ENTREPRISE',
}

/**
 * Un don au comité, en général ou pour un événement précis.
 *
 * **Un don anonyme ne garde aucune identité** : ni nom, ni email, ni compte.
 * Ce qui n'est pas conservé ne peut pas fuiter ni être demandé. Le seul
 * numéro qui reste est celui que l'opérateur de paiement détient de son côté.
 */
@Entity('dons')
export class Don extends BaseEntity {
  /** Aléatoire : connaître la référence suffit à suivre ce don, rien de plus. */
  @Index({ unique: true })
  @Column()
  @ApiProperty({ example: 'DON-1A2B3C4D5E6F' })
  reference: string;

  /** Ce que reçoit le comité, en FCFA — le montant que le donateur a choisi. */
  @Column({ type: 'int' })
  @ApiProperty({ description: 'Montant reçu par le comité, en FCFA.' })
  montant: number;

  /** Ce que le donateur a été débité : son don, plus les frais. */
  @Column({ name: 'montant_debite', type: 'int' })
  @ApiProperty({ description: 'Montant débité, frais compris, en FCFA.' })
  montantDebite: number;

  /** `null` : un don au comité en général. */
  @ManyToOne(() => Evenement, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'evenement_id' })
  @ApiPropertyOptional({ type: () => Evenement, nullable: true })
  evenement: Evenement | null;

  @Column({ default: false })
  @ApiProperty()
  anonyme: boolean;

  @Column({
    name: 'type_donateur',
    type: 'enum',
    enum: TypeDonateur,
    nullable: true,
  })
  @ApiPropertyOptional({ enum: TypeDonateur, nullable: true })
  typeDonateur: TypeDonateur | null;

  @Column({ type: 'varchar', nullable: true })
  prenom: string | null;

  @Column({ type: 'varchar', nullable: true })
  nom: string | null;

  @Column({ name: 'raison_sociale', type: 'varchar', nullable: true })
  raisonSociale: string | null;

  /** Personne à remercier, pour une entreprise. */
  @Column({ type: 'varchar', nullable: true })
  contact: string | null;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ name: 'telephone_contact', type: 'varchar', nullable: true })
  telephoneContact: string | null;

  /** Compte du donateur, quand il est connecté **et** ne veut pas rester anonyme. */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  message: string | null;

  @Column({
    type: 'enum',
    enum: StatutPaiement,
    default: StatutPaiement.EN_ATTENTE,
  })
  @ApiProperty({ enum: StatutPaiement })
  statut: StatutPaiement;

  @Column({
    name: 'methode_paiement',
    type: 'enum',
    enum: MethodePaiement,
    nullable: true,
  })
  methodePaiement: MethodePaiement | null;
}
