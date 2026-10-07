import { Role } from '../../common/enums/role.enum';
import type { User } from '../user/entities/user.entity';
import { CibleCotisation } from './entities/cotisation.entity';

/**
 * Cette personne est-elle appelée à cette cotisation ?
 *
 * C'est le **même critère** que celui de l'ouverture (`populationVisee`, en
 * SQL), appliqué à une seule personne. Il sert à rattraper celles qui sont
 * arrivées après l'ouverture : un finissant qui s'inscrit une semaine plus
 * tard doit voir la cotisation des finissants, au même titre que ceux qui
 * étaient là le jour où elle a été lancée.
 *
 * « Finissant » et « alumni » ne sont pas des rôles mais des statuts déduits de
 * la promotion et du mandat en cours : les confondre avec `STUDENT` ferait
 * cotiser les mauvaises personnes.
 *
 * @param anneeMandat année du mandat en cours, ou `null` sans génération
 *   active. L'alumni n'a alors pas de repère : la cible est ignorée plutôt que
 *   devinée.
 */
export function estVise(
  personne: Pick<User, 'role' | 'isFinissant' | 'promotion' | 'isActive'>,
  cibles: CibleCotisation[],
  anneeMandat: number | null,
): boolean {
  if (!personne.isActive) {
    return false;
  }

  return cibles.some((cible) => {
    switch (cible) {
      case CibleCotisation.FINISSANT:
        return personne.isFinissant;
      case CibleCotisation.ETUDIANT:
        return personne.role === Role.STUDENT;
      case CibleCotisation.VISITEUR:
        return personne.role === Role.VISITOR;
      case CibleCotisation.ADMIN:
        // Volontairement `ADMIN` seul, comme le filtre SQL de l'ouverture : la
        // cible vise le bureau, que la passation rétrograde à chaque mandat.
        // L'exploitation (`SUPER_ADMIN`) ne cotise pas à ce titre.
        // eslint-disable-next-line no-restricted-syntax
        return personne.role === Role.ADMIN;
      case CibleCotisation.ALUMNI:
        return (
          anneeMandat !== null &&
          personne.promotion !== null &&
          personne.promotion < anneeMandat
        );
    }
  });
}
