import { Article } from './entities/article.entity';

/** L'auteur tel que le public le voit : un nom et une photo, rien d'autre. */
export interface AuteurExpose {
  id: string;
  prenom: string;
  nom: string;
  avatar: string | null;
}

export type ArticleExpose = Omit<Article, 'auteur'> & {
  auteur: AuteurExpose | null;
};

/**
 * Projette un article pour la réponse.
 *
 * L'auteur est chargé par relation : renvoyé tel quel, il emporterait son
 * adresse email et ses autres champs sur une route ouverte à tous. Le public
 * n'a besoin que de son nom et de sa photo — sous les noms `prenom` / `nom`
 * que lit le frontal.
 */
export function exposerArticle(article: Article): ArticleExpose {
  const { auteur, ...reste } = article;

  return {
    ...reste,
    auteur: auteur
      ? {
          id: auteur.id,
          prenom: auteur.firstName,
          nom: auteur.lastName,
          avatar: auteur.avatar ?? null,
        }
      : null,
  };
}
