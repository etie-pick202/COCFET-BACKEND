import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Cotisation } from './cotisation.entity';

/**
 * Échéance intermédiaire d'une cotisation fractionnée.
 *
 * **Une tranche n'est pas un paiement.** C'est un jalon : elle dit combien
 * aurait dû être versé à telle date. Un versement, lui, est un montant libre
 * porté au solde de la personne, et les tranches sont ensuite consommées dans
 * l'ordre par ce solde.
 *
 * Ce choix est ce qui permet à la fois l'affichage attendu — « première
 * tranche réglée, deuxième à moitié » — et les cas que la vie impose : verser
 * à cheval sur deux tranches, ou tout régler d'un coup. Faire d'un versement
 * le règlement d'une tranche précise interdirait les deux.
 *
 * Les montants sont saisis, jamais déduits d'un pourcentage : leur somme doit
 * égaler le montant de la cotisation, contrôle fait à l'écriture. Une
 * cotisation dont les tranches ne totalisent pas le dû est une faute de
 * saisie, pas une configuration.
 */
@Unique('uq_tranche_cotisation_ordre', ['cotisation', 'ordre'])
@Entity('tranches_cotisation')
export class TrancheCotisation extends BaseEntity {
  @ManyToOne(() => Cotisation, (cotisation) => cotisation.tranches, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'cotisation_id' })
  cotisation: Cotisation;

  /** Rang de l'échéance. C'est dans cet ordre que le solde les consomme. */
  @Column({ type: 'int' })
  @ApiProperty({ example: 1 })
  ordre: number;

  @Column()
  @ApiProperty({ example: 'Première tranche' })
  libelle: string;

  @Column({ type: 'int' })
  @ApiProperty({ description: 'Montant de la tranche, en FCFA.' })
  montant: number;

  @Column({ name: 'date_limite', type: 'timestamptz' })
  @ApiProperty({ format: 'date-time' })
  dateLimite: Date;
}
