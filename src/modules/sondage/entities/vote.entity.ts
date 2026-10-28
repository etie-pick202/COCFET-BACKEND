import {
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
} from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { OptionSondage } from './option-sondage.entity';
import { Sondage } from './sondage.entity';

/**
 * L'index unique (sondage, user) empêche le double vote. Il n'a pas d'effet sur
 * les sondages anonymes, dont les votes ont un `user` nul — le contrôle
 * d'unicité y relève alors de la couche applicative.
 */
@Entity('votes')
@Index(['sondage', 'user'], { unique: true })
export class Vote extends BaseEntity {
  @ManyToOne(() => Sondage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sondage_id' })
  sondage: Sondage;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User | null;

  @ManyToMany(() => OptionSondage)
  @JoinTable({
    name: 'vote_options',
    joinColumn: { name: 'vote_id' },
    inverseJoinColumn: { name: 'option_id' },
  })
  options: OptionSondage[];
}
