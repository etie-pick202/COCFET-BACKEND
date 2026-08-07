import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Produit } from '../../boutique/entities/produit.entity';
import { Generation } from '../../generation/entities/generation.entity';
import { Sponsor } from '../../sponsor/entities/sponsor.entity';

export enum TypeEvenement {
  GRATUIT = 'GRATUIT',
  PAYANT = 'PAYANT',
  SUR_INVITATION = 'SUR_INVITATION',
}

export enum StatutEvenement {
  BROUILLON = 'BROUILLON',
  PUBLIE = 'PUBLIE',
  ARCHIVE = 'ARCHIVE',
}

@Entity('evenements')
export class Evenement extends BaseEntity {
  @Column()
  @ApiProperty()
  titre: string;

  @Column({ type: 'text' })
  @ApiProperty()
  description: string;

  @Column({ name: 'image_couverture', type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  imageCouverture: string | null;

  @Column({ name: 'date_debut', type: 'timestamptz' })
  @ApiProperty({ format: 'date-time' })
  dateDebut: Date;

  @Column({ name: 'date_fin', type: 'timestamptz', nullable: true })
  @ApiProperty({ nullable: true, format: 'date-time' })
  dateFin: Date | null;

  @Column()
  @ApiProperty()
  lieu: string;

  @Column({ name: 'lieu_url', type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  lieuUrl: string | null;

  @Column({ type: 'enum', enum: TypeEvenement, default: TypeEvenement.GRATUIT })
  @ApiProperty({ enum: TypeEvenement })
  type: TypeEvenement;

  /** Tarifs en FCFA (devise sans sous-unité, stockée en entier). */
  @Column({ name: 'prix_campus', type: 'int', default: 0 })
  @ApiProperty()
  prixCampus: number;

  @Column({ name: 'prix_externe', type: 'int', default: 0 })
  @ApiProperty()
  prixExterne: number;

  @Column({ name: 'capacite_max', type: 'int', default: 0 })
  @ApiProperty()
  capaciteMax: number;

  /** Dénormalisé pour afficher la jauge sans recompter les inscriptions. */
  @Column({ name: 'inscriptions_actuelles', type: 'int', default: 0 })
  @ApiProperty()
  inscriptionsActuelles: number;

  @Column({
    type: 'enum',
    enum: StatutEvenement,
    default: StatutEvenement.BROUILLON,
  })
  @ApiProperty({ enum: StatutEvenement })
  statut: StatutEvenement;

  @Column({ type: 'simple-array', nullable: true })
  @ApiProperty({ nullable: true, type: [String] })
  galerie: string[] | null;

  @Column({ type: 'text', nullable: true })
  @ApiProperty({ nullable: true })
  recap: string | null;

  @ManyToOne(() => Generation, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'generation_id' })
  @ApiProperty({ nullable: true, required: false })
  generation: Generation | null;

  @ManyToMany(() => Sponsor, (sponsor) => sponsor.evenements)
  @JoinTable({
    name: 'evenement_sponsors',
    joinColumn: { name: 'evenement_id' },
    inverseJoinColumn: { name: 'sponsor_id' },
  })
  @ApiProperty({ required: false })
  sponsors: Sponsor[];

  @OneToMany(() => Produit, (produit) => produit.evenement)
  @ApiProperty({ required: false })
  produits: Produit[];
}
