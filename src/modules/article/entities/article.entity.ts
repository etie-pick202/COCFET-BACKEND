import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Evenement } from '../../evenement/entities/evenement.entity';
import { User } from '../../user/entities/user.entity';

export enum StatutArticle {
  BROUILLON = 'BROUILLON',
  PUBLIE = 'PUBLIE',
  ARCHIVE = 'ARCHIVE',
}

@Entity('articles')
export class Article extends BaseEntity {
  @Column()
  titre: string;

  @Index({ unique: true })
  @Column()
  slug: string;

  @Column({ type: 'text' })
  contenu: string;

  @Column({ type: 'text', nullable: true })
  extrait: string | null;

  @Column({ name: 'image_couverture', type: 'varchar', nullable: true })
  imageCouverture: string | null;

  @Column({ type: 'varchar', nullable: true })
  categorie: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'auteur_id' })
  auteur: User | null;

  /** Un article peut couvrir un événement (compte rendu, annonce). */
  @ManyToOne(() => Evenement, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'evenement_id' })
  evenement: Evenement | null;

  @Column({
    type: 'enum',
    enum: StatutArticle,
    default: StatutArticle.BROUILLON,
  })
  statut: StatutArticle;

  /** Renseignée à la publication, permet la publication programmée. */
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  /**
   * Instant où la parution a été annoncée à la plateforme.
   *
   * Distincte de `publishedAt` : une parution programmée un vendredi soir est
   * datée à l'avance, mais l'annonce ne part qu'une fois l'heure venue. Sans
   * cette trace, la tâche planifiée renotifierait le même article à chacun de
   * ses passages.
   */
  @Column({ name: 'annonce_le', type: 'timestamptz', nullable: true })
  annonceLe: Date | null;
}
