import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Evenement } from '../../evenement/entities/evenement.entity';

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
  nom: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'simple-array', nullable: true })
  images: string[] | null;

  @Column({ name: 'prix_campus', type: 'int', default: 0 })
  prixCampus: number;

  @Column({ name: 'prix_externe', type: 'int', default: 0 })
  prixExterne: number;

  @Column({
    type: 'enum',
    enum: CategorieProduit,
    default: CategorieProduit.GOODIES,
  })
  categorie: CategorieProduit;

  @Column({ type: 'simple-array', nullable: true })
  tailles: string[] | null;

  @Column({ type: 'simple-array', nullable: true })
  couleurs: string[] | null;

  @Column({ type: 'int', default: 0 })
  stock: number;

  @Column({
    type: 'enum',
    enum: StatutProduit,
    default: StatutProduit.DISPONIBLE,
  })
  statut: StatutProduit;

  /** Un produit peut être rattaché à un événement (goodies dédiés). */
  @ManyToOne(() => Evenement, (evenement) => evenement.produits, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'evenement_id' })
  evenement: Evenement | null;

  @Column({ name: 'date_precommande', type: 'timestamptz', nullable: true })
  datePrecommande: Date | null;
}
