import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { User } from '../../user/entities/user.entity';
import { Article } from './article.entity';

/**
 * Un commentaire de lecteur sous une actualité.
 *
 * Réservé aux comptes connectés : un commentaire anonyme ne se modère pas, et
 * ne répond de personne. `masque` retire le commentaire de la page sans
 * l'effacer — la trace reste pour qui l'a modéré.
 */
@Entity('commentaires_article')
export class CommentaireArticle extends BaseEntity {
  @Index()
  @ManyToOne(() => Article, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'article_id' })
  article: Article;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'auteur_id' })
  auteur: User;

  @Column({ type: 'text' })
  contenu: string;

  @Column({ default: false })
  masque: boolean;
}
