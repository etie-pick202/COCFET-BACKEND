import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';

export enum TypeNotification {
  EVENEMENT = 'EVENEMENT',
  PAIEMENT = 'PAIEMENT',
  SONDAGE = 'SONDAGE',
  ARTICLE = 'ARTICLE',
  BOUTIQUE = 'BOUTIQUE',
  RAPPEL = 'RAPPEL',
  SYSTEME = 'SYSTEME',
}

@Entity('notifications')
export class Notification extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'enum', enum: TypeNotification })
  type: TypeNotification;

  @Column()
  titre: string;

  @Column({ type: 'text' })
  message: string;

  /** Lien in-app vers la ressource concernée. */
  @Column({ type: 'varchar', nullable: true })
  lien: string | null;

  @Column({ name: 'is_read', default: false })
  isRead: boolean;
}
