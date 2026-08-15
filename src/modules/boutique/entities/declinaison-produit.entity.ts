import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Produit } from './produit.entity';

/**
 * Stock d'une combinaison précise : une taille, une couleur.
 *
 * Un compteur unique par produit ne dit pas ce que l'acheteur a besoin de
 * savoir. Un sweat affiché « 12 en stock » peut n'avoir plus aucun M : la
 * déception passe alors du catalogue à la commande, et le bureau découvre le
 * problème en préparant le retrait.
 *
 * `taille` et `couleur` sont **nullables**, et c'est ce qui permet à un produit
 * sans déclinaison — un porte-clés — de vivre dans la même table qu'un
 * vêtement. Le couple nul désigne alors l'unique déclinaison du produit.
 *
 * L'unicité porte sur le triplet : deux lignes pour « M / Noir » rendraient le
 * stock indéterminé, et la réservation atomique choisirait au hasard laquelle
 * décrémenter.
 */
@Unique('uq_declinaison_produit', ['produit', 'taille', 'couleur'])
@Entity('declinaisons_produit')
export class DeclinaisonProduit extends BaseEntity {
  @ManyToOne(() => Produit, (produit) => produit.declinaisons, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'produit_id' })
  produit: Produit;

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true, example: 'M' })
  taille: string | null;

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true, example: 'Noir' })
  couleur: string | null;

  /**
   * Quantité disponible pour cette combinaison.
   *
   * Décrémentée **dans la condition même** de la mise à jour, comme le stock
   * global l'était : lire puis écrire laisserait deux commandes simultanées
   * passer la vérification avant que l'une ait écrit, et c'est exactement ainsi
   * qu'on vend deux fois le dernier M.
   */
  @Column({ type: 'int', default: 0 })
  @ApiProperty()
  stock: number;
}
