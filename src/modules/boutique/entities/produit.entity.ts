import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, OneToMany, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Evenement } from '../../evenement/entities/evenement.entity';
import { DeclinaisonProduit } from './declinaison-produit.entity';

export enum CategorieProduit {
  VETEMENT = 'VETEMENT',
  GOODIES = 'GOODIES',
  ACCESSOIRE = 'ACCESSOIRE',
}

export enum StatutProduit {
  DISPONIBLE = 'DISPONIBLE',
  PRECOMMANDE = 'PRECOMMANDE',
  RUPTURE = 'RUPTURE',
  RETIRE = 'RETIRE',
}

@Entity('produits')
export class Produit extends BaseEntity {
  @Column()
  @ApiProperty({ example: 'Sweat capuche promo 2027' })
  nom: string;

  @Column({ type: 'text' })
  @ApiProperty()
  description: string;

  @Column({ type: 'simple-array', nullable: true })
  @ApiProperty({
    nullable: true,
    type: [String],
    description: 'Cles de stockage — a echanger contre des URL signees.',
  })
  images: string[] | null;

  @Column({ name: 'prix_campus', type: 'int', default: 0 })
  @ApiProperty({ example: 12000, description: 'FCFA, entier.' })
  prixCampus: number;

  @Column({ name: 'prix_externe', type: 'int', default: 0 })
  @ApiProperty({ example: 15000, description: 'FCFA, entier.' })
  prixExterne: number;

  @Column({
    type: 'enum',
    enum: CategorieProduit,
    default: CategorieProduit.GOODIES,
  })
  @ApiProperty({ enum: CategorieProduit })
  categorie: CategorieProduit;

  @Column({ type: 'simple-array', nullable: true })
  @ApiProperty({ nullable: true, type: [String], example: ['S', 'M', 'L'] })
  tailles: string[] | null;

  @Column({ type: 'simple-array', nullable: true })
  @ApiProperty({ nullable: true, type: [String], example: ['Noir'] })
  couleurs: string[] | null;

  @Column({ type: 'int', default: 0 })
  @ApiProperty({ description: 'Ne descend jamais sous zero.' })
  stock: number;

  @Column({
    type: 'enum',
    enum: StatutProduit,
    default: StatutProduit.DISPONIBLE,
  })
  @ApiProperty({ enum: StatutProduit })
  statut: StatutProduit;

  /** Un produit peut être rattaché à un événement (goodies dédiés). */
  @ManyToOne(() => Evenement, (evenement) => evenement.produits, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'evenement_id' })
  @ApiProperty({ nullable: true, required: false })
  evenement: Evenement | null;

  @Column({ name: 'date_precommande', type: 'timestamptz', nullable: true })
  @ApiProperty({
    nullable: true,
    format: 'date-time',
    description: 'Disponibilite prevue, sur un article en precommande.',
  })
  datePrecommande: Date | null;

  /**
   * Stock detaille par taille et couleur.
   *
   * Vide, le produit n'a qu'un stock global — un porte-cles ne se decline pas.
   * Renseigne, c'est **lui qui fait foi** : « stock » n'est plus qu'une somme
   * tenue a jour pour le catalogue et le statut, jamais la source d'une
   * reservation.
   */
  @OneToMany(() => DeclinaisonProduit, (declinaison) => declinaison.produit, {
    cascade: true,
  })
  @ApiProperty({ type: () => [DeclinaisonProduit] })
  declinaisons: DeclinaisonProduit[];
}
