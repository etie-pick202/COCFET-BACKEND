import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Produit } from '../../boutique/entities/produit.entity';
import { Commande } from './commande.entity';

@Entity('lignes_commande')
export class LigneCommande extends BaseEntity {
  @ManyToOne(() => Commande, (commande) => commande.lignes, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'commande_id' })
  commande: Commande;

  @ManyToOne(() => Produit, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'produit_id' })
  @ApiProperty({ required: false })
  produit: Produit;

  @Column({ type: 'int', default: 1 })
  @ApiProperty({ example: 2 })
  quantite: number;

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true, example: 'M' })
  taille: string | null;

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true, example: 'Noir' })
  couleur: string | null;

  /** Prix unitaire figé à la commande (le tarif du produit peut évoluer). */
  @Column({ type: 'int' })
  @ApiProperty({
    description:
      'Prix unitaire fige a la commande : le tarif du produit peut evoluer ' +
      'sans changer les commandes deja passees.',
  })
  prix: number;
}
