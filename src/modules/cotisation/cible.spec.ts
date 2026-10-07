import { Role } from '../../common/enums/role.enum';
import { estVise } from './cible';
import { CibleCotisation } from './entities/cotisation.entity';

/**
 * Qui doit voir une cotisation. Le cas qui a motivé ce critère : un finissant
 * inscrit APRÈS l'ouverture de la cotisation des finissants ne la voyait pas.
 */
describe('estVise', () => {
  const personne = (surcharge = {}) => ({
    role: Role.STUDENT,
    isFinissant: false,
    promotion: 2027 as number | null,
    isActive: true,
    ...surcharge,
  });

  it('appelle un finissant à la cotisation des finissants', () => {
    expect(
      estVise(
        personne({ isFinissant: true }),
        [CibleCotisation.FINISSANT],
        2027,
      ),
    ).toBe(true);
  });

  it('n’y appelle pas un étudiant qui ne l’est pas', () => {
    expect(estVise(personne(), [CibleCotisation.FINISSANT], 2027)).toBe(false);
  });

  it('reconnaît le finissant à son statut, non à son rôle', () => {
    // Un visiteur peut être finissant (statut calculé) sans être STUDENT.
    expect(
      estVise(
        personne({ role: Role.VISITOR, isFinissant: true }),
        [CibleCotisation.FINISSANT],
        2027,
      ),
    ).toBe(true);
    expect(
      estVise(
        personne({ role: Role.STUDENT }),
        [CibleCotisation.FINISSANT],
        2027,
      ),
    ).toBe(false);
  });

  it.each([
    [CibleCotisation.ETUDIANT, Role.STUDENT, true],
    [CibleCotisation.ETUDIANT, Role.VISITOR, false],
    [CibleCotisation.VISITEUR, Role.VISITOR, true],
    [CibleCotisation.VISITEUR, Role.STUDENT, false],
    [CibleCotisation.ADMIN, Role.ADMIN, true],
    // L'exploitation n'est pas le bureau : elle ne cotise pas à ce titre.
    [CibleCotisation.ADMIN, Role.SUPER_ADMIN, false],
  ])('cible %s : rôle %s → %s', (cible, role, attendu) => {
    expect(estVise(personne({ role }), [cible], 2027)).toBe(attendu);
  });

  it('cumule plusieurs cibles', () => {
    const cibles = [CibleCotisation.ETUDIANT, CibleCotisation.VISITEUR];

    expect(estVise(personne({ role: Role.VISITOR }), cibles, 2027)).toBe(true);
    expect(estVise(personne({ role: Role.ADMIN }), cibles, 2027)).toBe(false);
  });

  describe('alumni', () => {
    it('situe la personne par rapport au mandat en cours', () => {
      expect(
        estVise(personne({ promotion: 2025 }), [CibleCotisation.ALUMNI], 2027),
      ).toBe(true);
      expect(
        estVise(personne({ promotion: 2027 }), [CibleCotisation.ALUMNI], 2027),
      ).toBe(false);
    });

    it('ignore la cible sans mandat actif ou sans promotion', () => {
      // Sans repère, la notion n'existe pas : la deviner ferait cotiser des
      // gens au hasard.
      expect(
        estVise(personne({ promotion: 2025 }), [CibleCotisation.ALUMNI], null),
      ).toBe(false);
      expect(
        estVise(personne({ promotion: null }), [CibleCotisation.ALUMNI], 2027),
      ).toBe(false);
    });
  });

  it('n’appelle jamais un compte désactivé', () => {
    expect(
      estVise(
        personne({ isFinissant: true, isActive: false }),
        [CibleCotisation.FINISSANT],
        2027,
      ),
    ).toBe(false);
  });

  it('n’appelle personne sans population visée', () => {
    expect(estVise(personne({ isFinissant: true }), [], 2027)).toBe(false);
  });
});
