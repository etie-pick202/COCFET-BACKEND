import {
  emettreJetonBillet,
  estJetonTournant,
  FENETRE_SECONDES,
  lireJetonBillet,
  secondesAvantRotation,
} from './jeton-billet';

const SECRET = 'secret-de-test-suffisamment-long-pour-hmac';
const CODE = 'COCFET-A1B2C3D4E5F6';

/** Instant fixe : l'horloge réelle ferait basculer de fenêtre en cours de test. */
const T0 = 1_800_000_000_000;
const fenetre = (n: number) => T0 + n * FENETRE_SECONDES * 1000;

describe('jeton de billet tournant', () => {
  it('se relit dans la fenêtre où il a été émis', () => {
    const jeton = emettreJetonBillet(CODE, SECRET, T0);

    expect(lireJetonBillet(jeton, SECRET, T0)).toBe(CODE);
  });

  it('tolère une fenêtre d’écart', () => {
    // Le code est affiché à un instant et lu à un autre : la file avance, et
    // les horloges du téléphone et du serveur ne coïncident pas à la seconde.
    const jeton = emettreJetonBillet(CODE, SECRET, T0);

    expect(lireJetonBillet(jeton, SECRET, fenetre(1))).toBe(CODE);
    expect(lireJetonBillet(jeton, SECRET, fenetre(-1))).toBe(CODE);
  });

  it('refuse au-delà', () => {
    // Le cœur du dispositif : une capture d'écran transmise arrive périmée.
    const jeton = emettreJetonBillet(CODE, SECRET, T0);

    expect(lireJetonBillet(jeton, SECRET, fenetre(2))).toBeNull();
    expect(lireJetonBillet(jeton, SECRET, fenetre(120))).toBeNull();
  });

  it('refuse un jeton signé avec un autre secret', () => {
    const jeton = emettreJetonBillet(
      CODE,
      'un-autre-secret-tout-aussi-long',
      T0,
    );

    expect(lireJetonBillet(jeton, SECRET, T0)).toBeNull();
  });

  it('refuse une signature retouchée', () => {
    const jeton = emettreJetonBillet(CODE, SECRET, T0);
    const [code, fen, signature] = jeton.split('.');
    const falsifie = [code, fen, `${signature.slice(0, -1)}X`].join('.');

    expect(lireJetonBillet(falsifie, SECRET, T0)).toBeNull();
  });

  it('refuse une fenêtre déplacée sans resignature', () => {
    // Repousser l'échéance en changeant le numéro de fenêtre : la signature
    // porte sur le couple, elle ne suit pas.
    const jeton = emettreJetonBillet(CODE, SECRET, T0);
    const [code, fen, signature] = jeton.split('.');
    const decale = [code, String(Number(fen) + 5), signature].join('.');

    expect(lireJetonBillet(decale, SECRET, T0)).toBeNull();
  });

  it('refuse un code d’entrée présenté tel quel', () => {
    expect(lireJetonBillet(CODE, SECRET, T0)).toBeNull();
    expect(lireJetonBillet('', SECRET, T0)).toBeNull();
    expect(lireJetonBillet('a.b.c', SECRET, T0)).toBeNull();
  });

  it('change de valeur d’une fenêtre à l’autre', () => {
    expect(emettreJetonBillet(CODE, SECRET, T0)).not.toBe(
      emettreJetonBillet(CODE, SECRET, fenetre(1)),
    );
  });

  it('distingue un jeton tournant d’un code fixe', () => {
    expect(estJetonTournant(emettreJetonBillet(CODE, SECRET, T0))).toBe(true);
    expect(estJetonTournant(CODE)).toBe(false);
  });

  it('annonce un délai de rotation exploitable', () => {
    const restant = secondesAvantRotation(T0 + 11_000);

    expect(restant).toBeGreaterThan(0);
    expect(restant).toBeLessThanOrEqual(FENETRE_SECONDES);
  });
});
