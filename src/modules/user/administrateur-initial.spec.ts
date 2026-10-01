import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import {
  creerPremierAdministrateur,
  DemandeAdministrateur,
  lireArgumentsAdministrateur,
  RefusCreationAdministrateur,
  verifierMotDePasse,
} from './administrateur-initial';
import { User } from './entities/user.entity';

/**
 * Le premier administrateur est le seul compte que l'application ne sait pas
 * se donner. Ce que l'on éprouve surtout : l'outil **refuse** quand il ne doit
 * pas — sans cela, il deviendrait un moyen d'ajouter des administrateurs à
 * volonté, hors de toute trace.
 */
describe('Premier administrateur', () => {
  const demande = (surcharge: Partial<DemandeAdministrateur> = {}) => ({
    email: 'Etienne.Mayack@exemple.test',
    prenom: 'Etienne',
    nom: 'Mayack',
    role: Role.ADMIN,
    motDePasse: 'une phrase de passe 2026',
    ...surcharge,
  });

  describe('creerPremierAdministrateur', () => {
    let depot: {
      existsBy: jest.Mock;
      create: jest.Mock;
      save: jest.Mock;
    };
    const sur = () => depot as unknown as Repository<User>;

    beforeEach(() => {
      depot = {
        existsBy: jest.fn().mockResolvedValue(false),
        create: jest.fn((valeurs: Partial<User>) => valeurs as User),
        save: jest.fn((utilisateur: User) => Promise.resolve(utilisateur)),
      };
    });

    it('crée le compte, actif et avec une adresse vérifiée', async () => {
      const cree = await creerPremierAdministrateur(sur(), demande());

      expect(cree).toMatchObject({
        firstName: 'Etienne',
        lastName: 'Mayack',
        role: Role.ADMIN,
        isActive: true,
      });
      // Le seul compte dont l'adresse n'a pas à être prouvée.
      expect(cree.emailVerifieLe).toBeInstanceOf(Date);
    });

    it('normalise l’adresse comme l’inscription le fait', async () => {
      // Sinon la personne se verrait refuser sa propre connexion : le login
      // cherche l'adresse normalisée.
      const cree = await creerPremierAdministrateur(
        sur(),
        demande({ email: ' Etienne+essai@Exemple.TEST ' }),
      );

      expect(cree.email).toBe('etienne@exemple.test');
    });

    it('ne stocke jamais le mot de passe en clair', async () => {
      const cree = await creerPremierAdministrateur(sur(), demande());

      expect(cree.passwordHash).toBeTruthy();
      expect(cree.passwordHash).not.toContain('phrase de passe');
      await expect(
        bcrypt.compare('une phrase de passe 2026', cree.passwordHash!),
      ).resolves.toBe(true);
    });

    it('accepte de créer un compte d’exploitation', async () => {
      const cree = await creerPremierAdministrateur(
        sur(),
        demande({ role: Role.SUPER_ADMIN }),
      );

      expect(cree.role).toBe(Role.SUPER_ADMIN);
    });

    it('refuse dès qu’un administrateur existe', async () => {
      // La garde qui empêche l'outil d'ajouter des administrateurs à volonté.
      depot.existsBy.mockResolvedValueOnce(true);

      await expect(
        creerPremierAdministrateur(sur(), demande()),
      ).rejects.toThrow(/administrateur existe déjà/);
      expect(depot.save).not.toHaveBeenCalled();
    });

    it('cherche un administrateur parmi les deux rôles d’administration', async () => {
      await creerPremierAdministrateur(sur(), demande());

      // SUPER_ADMIN compte aussi : un compte d'exploitation déjà en place
      // suffit à fermer l'outil.
      const [filtre] = depot.existsBy.mock.calls[0] as [
        { role: { _value: Role[] } },
      ];
      expect(filtre.role._value).toEqual([Role.ADMIN, Role.SUPER_ADMIN]);
    });

    it('refuse une adresse déjà prise', async () => {
      depot.existsBy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await expect(
        creerPremierAdministrateur(sur(), demande()),
      ).rejects.toThrow(/compte existe déjà pour etienne.mayack@exemple.test/);
      expect(depot.save).not.toHaveBeenCalled();
    });

    it('refuse un mot de passe faible avant de toucher à la base', async () => {
      await expect(
        creerPremierAdministrateur(sur(), demande({ motDePasse: 'court1!' })),
      ).rejects.toThrow(RefusCreationAdministrateur);
      expect(depot.existsBy).not.toHaveBeenCalled();
    });
  });

  describe('verifierMotDePasse', () => {
    it('applique la même règle que l’inscription', () => {
      expect(verifierMotDePasse('une phrase de passe 2026')).toBeNull();
      expect(verifierMotDePasse('court 1')).toMatch(/au moins 12/);
      // Longueur seule : « aaaaaaaaaaaa » est refusé, pas une phrase longue.
      expect(verifierMotDePasse('aaaaaaaaaaaaaaaa')).toMatch(
        /lettres et au moins/,
      );
      expect(verifierMotDePasse('123456789012345')).toMatch(
        /lettres et au moins/,
      );
    });

    it('compte les octets, pas les caractères', () => {
      // bcrypt tronque à 72 octets : trente-sept « é » en font soixante-quatorze.
      expect(verifierMotDePasse('é'.repeat(37) + '1')).toMatch(/72 octets/);
      expect(verifierMotDePasse('a1'.repeat(36))).toBeNull();
    });
  });

  describe('lireArgumentsAdministrateur', () => {
    const base = ['--email', 'a@b.test', '--prenom', 'Awa', '--nom', 'Ndiaye'];

    it('lit les trois informations et prend ADMIN par défaut', () => {
      expect(lireArgumentsAdministrateur(base)).toEqual({
        email: 'a@b.test',
        prenom: 'Awa',
        nom: 'Ndiaye',
        role: Role.ADMIN,
      });
    });

    it('accepte le rôle d’exploitation, quelle que soit la casse', () => {
      expect(
        lireArgumentsAdministrateur([...base, '--role', 'super_admin']).role,
      ).toBe(Role.SUPER_ADMIN);
    });

    it('refuse un rôle que l’outil ne peut pas attribuer', () => {
      // Un STUDENT ou un SPONSOR n'a rien à faire dans un outil d'amorçage.
      expect(() =>
        lireArgumentsAdministrateur([...base, '--role', 'STUDENT']),
      ).toThrow(/Rôle « STUDENT » refusé/);
    });

    it('exige les trois informations', () => {
      expect(() =>
        lireArgumentsAdministrateur(['--email', 'a@b.test']),
      ).toThrow(/obligatoires/);
    });

    it('refuse une adresse mal formée', () => {
      expect(() =>
        lireArgumentsAdministrateur([
          '--email',
          'pas-une-adresse',
          '--prenom',
          'A',
          '--nom',
          'B',
        ]),
      ).toThrow(/n'est pas une adresse/);
    });

    it('refuse un mot de passe passé en argument', () => {
      // Il finirait dans l'historique du shell et la liste des processus.
      expect(() =>
        lireArgumentsAdministrateur([
          ...base,
          '--mot-de-passe',
          'secret 123456',
        ]),
      ).toThrow(RefusCreationAdministrateur);
    });
  });
});
