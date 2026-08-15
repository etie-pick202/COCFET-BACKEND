import { EtatFenetre, etatFenetre, motifRefus } from './fenetre-scan';

/**
 * Fenêtre de validation d'un billet.
 *
 * Sans elle, un billet du gala de juin restait validable l'an suivant, et rien
 * n'empêchait de vider une salle par anticipation. Les deux bords comptent
 * autant l'un que l'autre.
 */
describe('etatFenetre', () => {
  const DEBUT = new Date('2027-06-12T18:00:00');

  it('ouvre deux heures avant le début', () => {
    // Les portiers arrivent en avance : refuser le premier billet à 17 h 55
    // ferait perdre le contrôle dès l'ouverture des portes.
    expect(etatFenetre(DEBUT, null, new Date('2027-06-12T16:00:00'))).toBe(
      EtatFenetre.OUVERTE,
    );
  });

  it('refuse juste avant l’ouverture', () => {
    expect(etatFenetre(DEBUT, null, new Date('2027-06-12T15:59:00'))).toBe(
      EtatFenetre.TROP_TOT,
    );
  });

  it('refuse la veille', () => {
    expect(etatFenetre(DEBUT, null, new Date('2027-06-11T18:00:00'))).toBe(
      EtatFenetre.TROP_TOT,
    );
  });

  it('reste ouverte pendant l’événement', () => {
    expect(etatFenetre(DEBUT, null, new Date('2027-06-12T20:30:00'))).toBe(
      EtatFenetre.OUVERTE,
    );
  });

  it('reste ouverte après minuit', () => {
    // Un gala se termine à 3 h du matin : couper à minuit refuserait les
    // derniers entrants en plein milieu de la soirée.
    expect(etatFenetre(DEBUT, null, new Date('2027-06-13T03:00:00'))).toBe(
      EtatFenetre.OUVERTE,
    );
  });

  it('ferme le lendemain à dix heures', () => {
    expect(etatFenetre(DEBUT, null, new Date('2027-06-13T09:59:00'))).toBe(
      EtatFenetre.OUVERTE,
    );
    expect(etatFenetre(DEBUT, null, new Date('2027-06-13T10:01:00'))).toBe(
      EtatFenetre.TROP_TARD,
    );
  });

  it('refuse l’année suivante', () => {
    // Le defaut d'origine : un billet passe restait indefiniment valable.
    expect(etatFenetre(DEBUT, null, new Date('2028-06-12T18:00:00'))).toBe(
      EtatFenetre.TROP_TARD,
    );
  });

  it('compte le lendemain de la fin quand elle est connue', () => {
    // Un événement sur deux jours ferme le surlendemain du début, pas le
    // lendemain : c'est la fin qui fait référence.
    const fin = new Date('2027-06-13T23:00:00');

    expect(etatFenetre(DEBUT, fin, new Date('2027-06-14T09:00:00'))).toBe(
      EtatFenetre.OUVERTE,
    );
    expect(etatFenetre(DEBUT, fin, new Date('2027-06-14T11:00:00'))).toBe(
      EtatFenetre.TROP_TARD,
    );
  });

  it('ferme le lendemain du debut quand la fin est inconnue', () => {
    expect(etatFenetre(DEBUT, null, new Date('2027-06-14T09:00:00'))).toBe(
      EtatFenetre.TROP_TARD,
    );
  });

  describe('motif rendu au portier', () => {
    it('distingue le trop tôt du trop tard', () => {
      // Un message générique enverrait le portier chercher un problème de
      // billet là où c'est l'heure qui bloque.
      expect(motifRefus(EtatFenetre.TROP_TOT)).toContain('pas encore commencé');
      expect(motifRefus(EtatFenetre.TROP_TARD)).toContain('terminé');
    });
  });
});
