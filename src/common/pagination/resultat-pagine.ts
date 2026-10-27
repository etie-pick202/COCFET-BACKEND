import { PaginationDto } from './pagination.dto';

export interface MetaPagination {
  page: number;
  limite: number;
  total: number;
  totalPages: number;
  aSuivante: boolean;
  aPrecedente: boolean;
}

/** Enveloppe unique de toutes les listes exposées par l'API. */
export interface ResultatPagine<T> {
  donnees: T[];
  meta: MetaPagination;
}

/**
 * Les informations de pagination, à partir de la page demandée et du total.
 *
 * Une seule façon de les calculer : les construire à la main, c'était omettre
 * `aSuivante` et `aPrecedente` sur deux listes, dont les boutons « Suivant » et
 * « Précédent » restaient alors grisés pour toujours.
 */
export function construireMeta(
  page: number,
  limite: number,
  total: number,
): MetaPagination {
  return {
    page,
    limite,
    total,
    totalPages: Math.ceil(total / limite),
    // Comparaison au total et non à `donnees.length` : une dernière page
    // pleine ne signifie pas qu'une suivante existe.
    aSuivante: page * limite < total,
    aPrecedente: page > 1,
  };
}

/**
 * Assemble le résultat à partir du couple `[donnees, total]` que renvoie
 * `findAndCount` / `getManyAndCount`.
 */
export function paginer<T>(
  [donnees, total]: [T[], number],
  pagination: PaginationDto,
): ResultatPagine<T> {
  const { page, limite } = pagination;

  return { donnees, meta: construireMeta(page, limite, total) };
}
