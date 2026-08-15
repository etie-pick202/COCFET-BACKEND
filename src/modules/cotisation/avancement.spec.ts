import { TrancheCotisation } from './entities/tranche-cotisation.entity';
import { calculerAvancement } from './avancement';

/**
 * Répartition d'un solde sur les tranches d'une cotisation.
 *
 * C'est le calcul qui porte tout le modèle : un versement n'est pas rattaché à
 * une tranche, il alimente un solde qui remplit les tranches dans l'ordre.
 * S'il se trompe, le bureau relance des gens à jour ou laisse filer des
 * retardataires.
 */
describe('calculerAvancement', () => {
  const LIMITE_PASSEE = new Date('2026-01-01T00:00:00Z');
  const LIMITE_FUTURE = new Date('2099-01-01T00:00:00Z');
  const MAINTENANT = new Date('2026-06-01T00:00:00Z');

  const tranche = (
    ordre: number,
    montant: number,
    dateLimite: Date,
  ): TrancheCotisation =>
    ({
      ordre,
      montant,
      dateLimite,
      libelle: `Tranche ${ordre}`,
    }) as TrancheCotisation;

  const TROIS_TRANCHES = [
    tranche(1, 10_000, LIMITE_PASSEE),
    tranche(2, 10_000, LIMITE_FUTURE),
    tranche(3, 10_000, LIMITE_FUTURE),
  ];

  it('remplit les tranches dans l’ordre', () => {
    const avancement = calculerAvancement(
      30_000,
      15_000,
      TROIS_TRANCHES,
      MAINTENANT,
    );

    expect(avancement.tranches.map((t) => t.regle)).toEqual([10_000, 5_000, 0]);
    expect(avancement.tranches.map((t) => t.soldee)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('accepte un versement à cheval sur deux tranches', () => {
    // Le cas que le rattachement à une tranche précise interdirait.
    const avancement = calculerAvancement(
      30_000,
      12_500,
      TROIS_TRANCHES,
      MAINTENANT,
    );

    expect(avancement.tranches[0].regle).toBe(10_000);
    expect(avancement.tranches[1].regle).toBe(2_500);
  });

  it('solde tout d’un coup quand la somme est versée en une fois', () => {
    const avancement = calculerAvancement(
      30_000,
      30_000,
      TROIS_TRANCHES,
      MAINTENANT,
    );

    expect(avancement.tranches.every((t) => t.soldee)).toBe(true);
    expect(avancement.enRetard).toBe(false);
    expect(avancement.pourcentage).toBe(100);
    expect(avancement.montantRestant).toBe(0);
  });

  it('signale le retard sur une échéance dépassée non couverte', () => {
    const avancement = calculerAvancement(
      30_000,
      5_000,
      TROIS_TRANCHES,
      MAINTENANT,
    );

    expect(avancement.tranches[0].enRetard).toBe(true);
    expect(avancement.enRetard).toBe(true);
  });

  it('ne déclare pas en retard qui a versé d’avance', () => {
    // La première échéance est passée, mais elle est couverte : cette personne
    // est en avance, pas en retard.
    const avancement = calculerAvancement(
      30_000,
      20_000,
      TROIS_TRANCHES,
      MAINTENANT,
    );

    expect(avancement.enRetard).toBe(false);
  });

  it('borne le pourcentage à cent sur un trop-perçu', () => {
    // 130 % laisserait croire à une erreur de saisie plutôt qu'à un
    // trop-perçu, que la trésorerie traitera à part.
    const avancement = calculerAvancement(
      30_000,
      39_000,
      TROIS_TRANCHES,
      MAINTENANT,
    );

    expect(avancement.pourcentage).toBe(100);
    expect(avancement.montantRestant).toBe(0);
  });

  it('range les tranches reçues dans le désordre', () => {
    const desordre = [
      tranche(3, 10_000, LIMITE_FUTURE),
      tranche(1, 10_000, LIMITE_PASSEE),
      tranche(2, 10_000, LIMITE_FUTURE),
    ];

    const avancement = calculerAvancement(30_000, 10_000, desordre, MAINTENANT);

    expect(avancement.tranches.map((t) => t.ordre)).toEqual([1, 2, 3]);
    expect(avancement.tranches[0].regle).toBe(10_000);
  });

  it('traite une cotisation sans tranche', () => {
    // Non fractionnable : le solde se lit sur le seul montant total.
    const avancement = calculerAvancement(30_000, 30_000, [], MAINTENANT);

    expect(avancement.tranches).toEqual([]);
    expect(avancement.pourcentage).toBe(100);
    expect(avancement.enRetard).toBe(false);
  });

  it('rend cent pour cent quand rien n’est dû', () => {
    // Évite une division par zéro qui produirait NaN dans la réponse.
    const avancement = calculerAvancement(0, 0, [], MAINTENANT);

    expect(avancement.pourcentage).toBe(100);
  });

  it('n’impute rien de négatif quand rien n’a été versé', () => {
    const avancement = calculerAvancement(
      30_000,
      0,
      TROIS_TRANCHES,
      MAINTENANT,
    );

    expect(avancement.tranches.every((t) => t.regle === 0)).toBe(true);
    expect(avancement.montantRestant).toBe(30_000);
  });
});
