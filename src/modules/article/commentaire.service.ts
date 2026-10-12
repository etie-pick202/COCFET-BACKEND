import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { Role, estAdministrateur } from '../../common/enums/role.enum';
import {
  paginer,
  PaginationDto,
  ResultatPagine,
} from '../../common/pagination';
import { Article, StatutArticle } from './entities/article.entity';
import { CommentaireArticle } from './entities/commentaire-article.entity';

/** Délai minimal entre deux commentaires d'une même personne. */
const DELAI_ENTRE_COMMENTAIRES_MS = 10_000;

/** Un commentaire tel que le public le lit : un nom, une photo, un texte. */
export interface CommentaireExpose {
  id: string;
  contenu: string;
  masque: boolean;
  createdAt: Date;
  auteur: {
    id: string;
    prenom: string;
    nom: string;
    avatar: string | null;
  };
}

/**
 * Commentaires des lecteurs sous une actualité.
 *
 * Réservés aux comptes connectés, pour que chaque commentaire réponde de
 * quelqu'un. La modération retire sans effacer (`masque`) ; l'auteur peut,
 * lui, supprimer le sien.
 */
@Injectable()
export class CommentaireService {
  constructor(
    @InjectRepository(CommentaireArticle)
    private readonly commentaires: Repository<CommentaireArticle>,
    @InjectRepository(Article)
    private readonly articles: Repository<Article>,
  ) {}

  async lister(
    articleId: string,
    pagination: PaginationDto,
    demandeur?: { role: Role },
  ): Promise<ResultatPagine<CommentaireExpose>> {
    // Passer par la lecture de l'article rend son brouillon aussi introuvable
    // que d'habitude : on ne lit pas les commentaires d'un article invisible.
    await this.articleLisible(articleId, demandeur);

    const admin = estAdministrateur(demandeur?.role);
    const resultat = await this.commentaires.findAndCount({
      where: {
        article: { id: articleId },
        ...(admin ? {} : { masque: false }),
      },
      relations: { auteur: true },
      order: { createdAt: 'ASC' },
      skip: pagination.sauter,
      take: pagination.limite,
    });

    const page = paginer(resultat, pagination);
    return { ...page, donnees: page.donnees.map((c) => this.exposer(c)) };
  }

  async publier(
    userId: string,
    articleId: string,
    contenu: string,
  ): Promise<CommentaireExpose> {
    const article = await this.articleLisible(articleId);

    if (!article.commentairesActifs) {
      throw new ConflictException(
        'Les commentaires sont fermés sur cette actualité.',
      );
    }

    const recent = await this.commentaires.countBy({
      auteur: { id: userId },
      createdAt: MoreThan(new Date(Date.now() - DELAI_ENTRE_COMMENTAIRES_MS)),
    });
    if (recent > 0) {
      throw new HttpException(
        'Patientez quelques secondes avant de commenter à nouveau.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const cree = await this.commentaires.save(
      this.commentaires.create({
        article: { id: articleId },
        auteur: { id: userId },
        contenu,
      }),
    );

    return this.exposer(await this.charger(cree.id));
  }

  /** L'auteur du commentaire, ou l'administration. */
  async supprimer(
    id: string,
    demandeur: { id: string; role: Role },
  ): Promise<void> {
    const commentaire = await this.charger(id);

    if (
      commentaire.auteur.id !== demandeur.id &&
      !estAdministrateur(demandeur.role)
    ) {
      throw new ForbiddenException(
        'Vous ne pouvez supprimer que vos propres commentaires.',
      );
    }

    await this.commentaires.delete(id);
  }

  async masquer(id: string, masque: boolean): Promise<CommentaireExpose> {
    await this.charger(id);
    await this.commentaires.update(id, { masque });
    return this.exposer(await this.charger(id));
  }

  // ─────────────────────────────  Interne  ──────────────────────────────

  private async charger(id: string): Promise<CommentaireArticle> {
    const commentaire = await this.commentaires.findOne({
      where: { id },
      relations: { auteur: true },
    });

    if (!commentaire) {
      throw new NotFoundException("Ce commentaire n'existe pas.");
    }

    return commentaire;
  }

  private async articleLisible(
    id: string,
    demandeur?: { role: Role },
  ): Promise<Article> {
    const article = await this.articles.findOneBy({ id });

    const paru =
      article?.statut === StatutArticle.PUBLIE &&
      article.publishedAt !== null &&
      article.publishedAt.getTime() <= Date.now();

    if (!article || (!paru && !estAdministrateur(demandeur?.role))) {
      throw new NotFoundException("Cet article n'existe pas.");
    }

    return article;
  }

  private exposer(commentaire: CommentaireArticle): CommentaireExpose {
    const { auteur } = commentaire;

    return {
      id: commentaire.id,
      contenu: commentaire.contenu,
      masque: commentaire.masque,
      createdAt: commentaire.createdAt,
      auteur: {
        id: auteur.id,
        prenom: auteur.firstName,
        nom: auteur.lastName,
        avatar: auteur.avatar ?? null,
      },
    };
  }
}
