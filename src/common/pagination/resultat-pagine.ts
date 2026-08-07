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
 * Assemble le résultat à partir du couple `[donnees, total]` que renvoie
 * `findAndCount` / `getManyAndCount`.
 */
export function paginer<T>(
  [donnees, total]: [T[], number],
  pagination: PaginationDto,
): ResultatPagine<T> {
  const { page, limite } = pagination;
  const totalPages = Math.ceil(total / limite);

  return {
    donnees,
    meta: {
      page,
      limite,
      total,
      totalPages,
      // Comparaison au total et non à `donnees.length` : une dernière page
      // pleine ne signifie pas qu'une suivante existe.
      aSuivante: page * limite < total,
      aPrecedente: page > 1,
    },
  };
}
