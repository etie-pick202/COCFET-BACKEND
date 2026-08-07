import { getMetadataArgsStorage } from 'typeorm';
import { Role } from '../../../common/enums/role.enum';
import { User } from '../entities/user.entity';
import { exposerUtilisateur } from './user.dto';

/** Ni un mot de passe ni une vraie empreinte : un jeu d'essai reconnaissable. */
const EMPREINTE_FACTICE = `$2b$12$${'empreinte-de-test'}`;

const compte = (surcharges: Partial<User> = {}): User =>
  Object.assign(new User(), {
    id: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
    email: 'etienne.mayack@2027.ucac-icam.com',
    passwordHash: EMPREINTE_FACTICE,
    firstName: 'Etienne',
    lastName: 'Mayack',
    role: Role.STUDENT,
    avatar: null,
    promotion: 2027,
    isFinissant: true,
    emailVerifieLe: new Date('2026-01-15T09:00:00.000Z'),
    refreshTokenHash: 'empreinte-du-refresh',
    isActive: true,
    createdAt: new Date('2026-01-15T08:00:00.000Z'),
    updatedAt: new Date('2026-02-01T08:00:00.000Z'),
    ...surcharges,
  });

/**
 * `select: false` est la seule chose qui empêche les empreintes de sortir dès
 * qu'une entité User est sérialisée — directement, ou via une relation `user`
 * chargée depuis le bureau, les notifications ou une fiche sponsor. Retirer
 * l'option ne casse rien d'autre : tout continue de fonctionner, les
 * empreintes partent simplement dans le JSON.
 */
describe('Entité User', () => {
  const optionsDe = (propriete: string) =>
    getMetadataArgsStorage().columns.find(
      (colonne) =>
        colonne.target === User && colonne.propertyName === propriete,
    )?.options;

  it.each(['passwordHash', 'refreshTokenHash'])(
    'ne charge pas %s par défaut',
    (propriete) => {
      expect(optionsDe(propriete)).toMatchObject({ select: false });
    },
  );

  it('laisse les colonnes non sensibles se charger', () => {
    expect(optionsDe('email')?.select).not.toBe(false);
    expect(optionsDe('role')?.select).not.toBe(false);
  });
});

describe('exposerUtilisateur', () => {
  it('omet les empreintes même lorsqu’elles sont chargées', () => {
    const expose = exposerUtilisateur(compte());

    expect(expose).not.toHaveProperty('passwordHash');
    expect(expose).not.toHaveProperty('refreshTokenHash');
    expect(JSON.stringify(expose)).not.toContain('$2b$');
  });

  it('conserve les champs destinés au client', () => {
    expect(exposerUtilisateur(compte())).toEqual({
      id: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
      email: 'etienne.mayack@2027.ucac-icam.com',
      prenom: 'Etienne',
      nom: 'Mayack',
      role: Role.STUDENT,
      avatar: null,
      promotion: 2027,
      isFinissant: true,
      isActive: true,
      emailVerifie: true,
      aUnMotDePasse: true,
      creeLe: new Date('2026-01-15T08:00:00.000Z'),
    });
  });

  it('signale un sponsor invité qui n’a pas encore activé son accès', () => {
    expect(exposerUtilisateur(compte({ passwordHash: null }))).toMatchObject({
      aUnMotDePasse: false,
    });
  });

  it('ne modifie pas l’entité source', () => {
    const user = compte();
    exposerUtilisateur(user);

    expect(user.passwordHash).toBe(EMPREINTE_FACTICE);
  });

  /**
   * Le cas qui motive le garde-fou : `select: false` rend `passwordHash`
   * `undefined` et non `null`. Sans ce contrôle, `aUnMotDePasse` vaudrait
   * silencieusement `true` pour un sponsor qui n'a pourtant pas de mot de
   * passe — une réponse fausse qu'aucun test n'aurait relevée.
   */
  it('refuse un compte chargé sans son empreinte', () => {
    const user = compte();
    delete (user as Partial<User>).passwordHash;

    expect(() => exposerUtilisateur(user)).toThrow(/empreinte/);
  });
});
