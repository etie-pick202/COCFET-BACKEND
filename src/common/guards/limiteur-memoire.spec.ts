import { LimiteurMemoire } from './limiteur-memoire';

describe('LimiteurMemoire', () => {
  const T0 = Date.parse('2026-10-30T12:00:00Z');

  it('laisse passer jusqu’au plafond, puis refuse', () => {
    const limiteur = new LimiteurMemoire();

    expect(limiteur.autoriser('ip:a', 2, 60, T0)).toBe(true);
    expect(limiteur.autoriser('ip:a', 2, 60, T0 + 1)).toBe(true);
    expect(limiteur.autoriser('ip:a', 2, 60, T0 + 2)).toBe(false);
  });

  it('compte chaque clé à part', () => {
    const limiteur = new LimiteurMemoire();

    limiteur.autoriser('ip:a', 1, 60, T0);

    expect(limiteur.autoriser('ip:b', 1, 60, T0)).toBe(true);
  });

  it('rouvre une fois la fenêtre écoulée', () => {
    const limiteur = new LimiteurMemoire();
    limiteur.autoriser('ip:a', 1, 60, T0);

    expect(limiteur.autoriser('ip:a', 1, 60, T0 + 59_000)).toBe(false);
    expect(limiteur.autoriser('ip:a', 1, 60, T0 + 60_000)).toBe(true);
  });

  it('purge les fenêtres échues quand elles s’accumulent', () => {
    const limiteur = new LimiteurMemoire();
    for (let i = 0; i < 10_000; i++) {
      limiteur.autoriser(`ip:${i}`, 1, 1, T0);
    }

    // Toutes échues : la prochaine ouverture les purge, la clé repart à zéro.
    expect(limiteur.autoriser('ip:0', 1, 1, T0 + 2_000)).toBe(true);
    expect(limiteur.autoriser('ip:1', 1, 1, T0 + 2_000)).toBe(true);
  });
});
