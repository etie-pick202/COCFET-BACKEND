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

  /**
   * Clé de stockage de l'image qui accompagne l'option (le visuel d'un thème,
   * d'un maillot, d'un menu), ou nul pour une option de texte seul.
   *
   * Une clé et non une URL : l'URL signée expire, la clé non. Le frontend la
   * résout à l'affichage, comme pour les images de produits.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  image: string | null;

  /** Compteur dénormalisé, incrémenté à chaque vote. */
  @Column({ type: 'int', default: 0 })
  votes: number;
}
