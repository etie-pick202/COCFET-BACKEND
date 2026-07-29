import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Sondage } from './sondage.entity';

@Entity('options_sondage')
export class OptionSondage extends BaseEntity {
  @ManyToOne(() => Sondage, (sondage) => sondage.options, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sondage_id' })
  sondage: Sondage;

  @Column({ type: 'text' })
  texte: string;

  /** Compteur dénormalisé, incrémenté à chaque vote. */
  @Column({ type: 'int', default: 0 })
  votes: number;
}
