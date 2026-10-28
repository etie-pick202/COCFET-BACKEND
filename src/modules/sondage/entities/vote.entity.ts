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
 * L'index sert à retrouver les bulletins d'une personne. Il n'est **pas
 * unique** : un sondage peut autoriser plusieurs votes par personne, et le
 * double vote des autres est arrêté par l'index unique des participations,
 * seule table dont le lien avec la personne existe sur un sondage anonyme.
 */
@Entity('votes')
@Index(['sondage', 'user'])
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
