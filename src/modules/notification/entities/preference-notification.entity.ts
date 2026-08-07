import { Column, Entity, Index, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { TypeNotification } from './notification.entity';

/**
 * Réglage d'un utilisateur pour un type de notification donné.
 *
 * L'absence de ligne vaut « tout activé » : aucun enregistrement n'est créé à
 * l'inscription, et un nouveau type de notification est reçu par défaut. C'est
 * délibéré — l'inverse ferait qu'une fonctionnalité ajoutée plus tard resterait
 * silencieuse pour tous les comptes existants.
 */
@Entity('preferences_notification')
@Unique('uq_preference_user_type', ['user', 'type'])
export class PreferenceNotification extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: TypeNotification })
  type: TypeNotification;

  /**
   * La notification consultable dans l'application ne se désactive pas : elle
   * ne dérange personne, et c'est la trace qui permet de retrouver après coup
   * un billet ou une commande. Seuls les canaux intrusifs se coupent.
   */
  @Column({ name: 'canal_email', default: true })
  canalEmail: boolean;

  @Column({ name: 'canal_push', default: true })
  canalPush: boolean;
}
