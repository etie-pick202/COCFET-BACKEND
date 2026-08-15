import { ApiProperty } from '@nestjs/swagger';
import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';

/**
 * Remise au bureau de l'argent qu'un membre des finances détenait.
 *
 * Un paiement remis en main propre entre dans la poche de quelqu'un avant
 * d'entrer dans les comptes. Sans cette trace, le montant encaissé par un
 * membre ne ferait que croître et ne répondrait plus à la seule question qui
 * compte : **combien détient-il aujourd'hui ?**
 *
 * L'encaisse d'un membre est donc la différence entre ce qu'il a reçu — les
 * justificatifs validés dont il est le destinataire — et ce qu'il a versé.
 *
 * Déclaratif : c'est le membre qui affirme avoir remis. La pièce jointe et le
 * contrôle du bureau font le reste. La plateforme tient un registre, elle ne
 * remplace pas la confiance ni les comptes.
 */
@Entity('versements_finance')
export class VersementFinance extends BaseEntity {
  /** Qui remet. Toujours un membre ayant l'accès aux finances. */
  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'membre_id' })
  @ApiProperty({ type: () => User })
  membre: User;

  @Column({ type: 'int' })
  @ApiProperty({ description: 'Montant remis, en FCFA.' })
  montant: number;

  /**
   * Qui a reçu la remise.
   *
   * `SET NULL` : le départ d'un membre ne doit pas effacer une remise qu'il a
   * constatée, sous peine de rouvrir une encaisse déjà soldée.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recu_par_id' })
  @ApiProperty({ type: () => User, nullable: true })
  recuPar: User | null;

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true, description: 'Note libre : dépôt, motif…' })
  note: string | null;
}
