import { calculerAvancement } from './avancement';
import { echeancesPayables, LIBELLE_TOTALITE } from './echeances';
import { TrancheCotisation } from './entities/tranche-cotisation.entity';

/**
 * Les échéances proposées au paiement. La règle qui compte : seule la
 * prochaine tranche non soldée est payable — c'est ce qui garantit qu'en
 * régler une la ferme exactement.
 */
describe('echeancesPayables', () => {
  const tranches = [
    {
      ordre: 1,
      libelle: 'T1',
      montant: 10_000,
      dateLimite: new Date('2099-01-31'),
    },
    {
      ordre: 2,
      libelle: 'T2',
      montant: 20_000,
      dateLimite: new Date('2099-03-31'),
    },
  ] as TrancheCotisation[];

  const contexte = {
    ouverte: true,
    fractionnable: true,
    dateCloture: new Date('2099-06-30'),
    reglementEnAttente: false,
  };

  const pour = (regle: number, surcharge = {}) =>
    echeancesPayables(calculerAvancement(30_000, regle, tranches), {
      ...contexte,
      ...surcharge,
    });

  it('fait de la totalité une échéance close à la clôture', () => {
    const totalite = pour(0).find((e) => e.ordreTranche === null)!;

    expect(totalite.libelle).toBe(LIBELLE_TOTALITE);
    expect(totalite.montant).toBe(30_000);
    expect(totalite.dateLimite).toBe('2099-06-30T00:00:00.000Z');
  });

  it('propose le reste d’une tranche entamée', () => {
    const [premiere] = pour(4_000);

    expect(premiere).toMatchObject({
      ordreTranche: 1,
      montant: 6_000,
      payable: true,
    });
  });

  it('n’affiche pas deux fois le même paiement', () => {
    // Première tranche réglée : la seconde vaut tout le reste dû.
    expect(pour(10_000).map((e) => e.ordreTranche)).toEqual([2]);
  });

  it('ne propose rien une fois soldée', () => {
    expect(pour(30_000)).toEqual([]);
  });

  it('ne laisse rien payer sur une cotisation close', () => {
    expect(pour(0, { ouverte: false }).every((e) => !e.payable)).toBe(true);
  });

  it('chiffre les frais par opérateur, en plus du montant', () => {
    const [premiere] = pour(0);

    expect(premiere.frais.ORANGE_MONEY.prixBase).toBe(10_000);
    expect(premiere.frais.ORANGE_MONEY.montantTtc).toBeGreaterThan(10_000);
    expect(premiere.frais.MTN_MOMO.montantTtc).toBeGreaterThan(
      premiere.frais.ORANGE_MONEY.montantTtc,
    );
  });
});
