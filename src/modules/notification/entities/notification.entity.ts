import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({ required: false })
  user: User;

  @Column({ type: 'enum', enum: TypeNotification })
  @ApiProperty({ enum: TypeNotification })
  type: TypeNotification;

  @Column()
  @ApiProperty()
  titre: string;

  @Column({ type: 'text' })
  @ApiProperty()
  message: string;

  /** Lien in-app vers la ressource concernée. */
  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({ nullable: true })
  lien: string | null;

  @Column({ name: 'is_read', default: false })
  @ApiProperty()
  isRead: boolean;
}
