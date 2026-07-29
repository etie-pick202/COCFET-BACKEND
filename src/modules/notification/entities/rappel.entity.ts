import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Evenement } from '../../evenement/entities/evenement.entity';
import { User } from '../../user/entities/user.entity';

export enum CanalRappel {
  PUSH = 'PUSH',
  EMAIL = 'EMAIL',
}

/** Rappel personnalisé programmé par un utilisateur avant un événement. */
@Entity('rappels')
export class Rappel extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Evenement, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'evenement_id' })
  evenement: Evenement;

  @Column({ name: 'date_rappel', type: 'timestamptz' })
  dateRappel: Date;

  @Column({ type: 'simple-array' })
  canaux: CanalRappel[];

  @Column({ name: 'is_sent', default: false })
  isSent: boolean;
}
