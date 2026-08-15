import {
  estAdministrateur,
  Role,
  ROLES_ADMINISTRATEURS,
  ROLES_ATTRIBUABLES,
} from './role.enum';

/**
 * Le rôle d'exploitation et sa portée.
 *
 * Deux garanties se jouent ici, et une régression sur l'une ou l'autre serait
 * invisible à l'usage courant : le rôle **administre** partout où
 * l'administration ordinaire administre, et il ne s'obtient **par aucune
 * requête**.
 */
describe('Rôles', () => {
  describe('estAdministrateur', () => {
    it('reconnaît l’administration du bureau', () => {
      expect(estAdministrateur(Role.ADMIN)).toBe(true);
    });

    it('reconnaît le rôle d’exploitation', () => {
      // La garantie centrale : comparer directement à `Role.ADMIN` le
      // laisserait dehors, donc moins puissant que l'administration
      // ordinaire — l'inverse de ce qu'il doit être.
      expect(estAdministrateur(Role.SUPER_ADMIN)).toBe(true);
    });

    it.each([Role.VISITOR, Role.STUDENT, Role.SPONSOR])('écarte %s', (role) => {
      expect(estAdministrateur(role)).toBe(false);
    });

    it('écarte une absence de rôle', () => {
      // Les services reçoivent souvent un demandeur optionnel : un appel
      // anonyme ne doit pas passer pour une administration.
      expect(estAdministrateur(undefined)).toBe(false);
      expect(estAdministrateur(null)).toBe(false);
    });
  });

  describe('rôles attribuables', () => {
    it('n’expose pas le rôle d’exploitation', () => {
      // Sans cette exclusion, une administration se l'attribuerait par la
      // route de mise a jour d'un compte, et il n'aurait plus rien
      // d'exceptionnel.
      expect(ROLES_ATTRIBUABLES).not.toContain(Role.SUPER_ADMIN);
    });

    it('couvre tous les autres rôles', () => {
      // Un rôle oublié ici deviendrait impossible à attribuer, sans que rien
      // ne le signale.
      const attendus = Object.values(Role).filter(
        (role) => role !== Role.SUPER_ADMIN,
      );

      expect(new Set(ROLES_ATTRIBUABLES)).toEqual(new Set(attendus));
    });
  });

  describe('rôles administrateurs', () => {
    it('réunit exactement les deux', () => {
      expect(new Set(ROLES_ADMINISTRATEURS)).toEqual(
        new Set([Role.ADMIN, Role.SUPER_ADMIN]),
      );
    });
  });
});
