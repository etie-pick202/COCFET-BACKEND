import { ApiProperty } from '@nestjs/swagger';
import { Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Evenement } from '../../evenement/entities/evenement.entity';
import { User } from '../../user/entities/user.entity';

/**
 * Droit de valider les billets d'un événement précis.
 *
 * Le contrôle à l'entrée était réservé à l'administration, ce qui obligeait à
 * confier les clés de la plateforme à quiconque tenait la porte. L'affectation
 * dissocie les deux : un portier valide des billets sans rien administrer.
 *
 * **Elle porte sur un événement**, jamais sur la plateforme entière. Sans
 * cela, un portier du gala validerait les billets de la conférence du
 * lendemain, à laquelle personne ne l'a placé.
 *
 * **Aucune date d'expiration n'est stockée.** L'affectation cesse de valoir
 * quand la fenêtre de validation de l'événement s'est refermée, ce qui se
 * calcule à la lecture. Une date figée dériverait dès qu'on décale
 * l'événement, et il faudrait penser à la corriger — ce que personne ne ferait.
 */
@Unique('uq_affectation_scanner', ['evenement', 'user'])
@Entity('affectations_scanner')
export class AffectationScanner extends BaseEntity {
  @ManyToOne(() => Evenement, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'evenement_id' })
  @ApiProperty({ type: () => Evenement })
  evenement: Evenement;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  @ApiProperty({ type: () => User })
  user: User;

  /**
   * Qui a placé cette personne à la porte.
   *
   * `SET NULL` : le départ d'un membre du bureau ne doit pas effacer les
   * affectations qu'il a faites, sous peine de retirer un portier de son poste
   * la veille de l'événement.
   */
  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'affecte_par_id' })
  @ApiProperty({ type: () => User, nullable: true })
  affectePar: User | null;
}
