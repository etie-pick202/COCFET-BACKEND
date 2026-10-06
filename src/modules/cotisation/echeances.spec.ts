import { calculerAvancement } from './avancement';
import {
  echeancesPayables,
  LIBELLE_TOTALITE,
  LIBELLE_VERSEMENT_LIBRE,
  MONTANT_MINIMAL_REGLEMENT,
  montantAutorise,
} from './echeances';
import { TrancheCotisation } from './entities/tranche-cotisation.entity';

/**
 * Les échéances proposées au paiement.
 *
 * Le cas qui a motivé le modèle : une cotisation de 50 000 F en trois tranches
 * (30 000, 15 000, 5 000). On doit pouvoir régler la première à son rythme —
 * cinq mille francs six fois de suite — avec, à chaque fois, le pourcentage
 * réellement atteint, sans jamais pouvoir payer deux fois la même part, ni
 * se voir proposer « tout » alors que la moitié est déjà versée.
 */
describe('echeancesPayables', () => {
  const tranches = [
    {
      ordre: 1,
      libelle: 'T1',
      montant: 30_000,
      dateLimite: new Date('2099-01-31'),
    },
    {
      ordre: 2,
      libelle: 'T2',
      montant: 15_000,
      dateLimite: new Date('2099-03-31'),
    },
    {
      ordre: 3,
      libelle: 'T3',
      montant: 5_000,
      dateLimite: new Date('2099-05-31'),
    },
  ] as TrancheCotisation[];

  const contexte = {
    ouverte: true,
    fractionnable: true,
    dateCloture: new Date('2099-06-30'),
  };

  /** Échéances d'une personne qui a réglé `regle` et en a `enAttente` à valider. */
  const pour = (
    regle: number,
    enAttente = 0,
    surcharge = {},
    liste = tranches,
  ) =>
    echeancesPayables(
      calculerAvancement(50_000, regle, liste, new Date(), enAttente),
      { ...contexte, ...surcharge },
    );

  describe('règlement à son rythme', () => {
    it('laisse choisir le montant d’une tranche, du plancher à son reste', () => {
      const [premiere] = pour(0);

      expect(premiere).toMatchObject({
        ordreTranche: 1,
        montant: 30_000,
        montantMin: MONTANT_MINIMAL_REGLEMENT,
        libre: true,
        payable: true,
        pourcentage: 0,
      });
    });

    it('rend à chaque versement ce qu’il reste, et le pourcentage atteint', () => {
      // Cinq mille francs versés sur trente mille.
      const [premiere] = pour(5_000);

      expect(premiere).toMatchObject({
        ordreTranche: 1,
        montant: 25_000,
        regle: 5_000,
        montantEcheance: 30_000,
        pourcentage: 17,
      });
    });

    it('atteint 100 % après six versements de 5 000', () => {
      const apres = (versements: number) => pour(versements * 5_000)[0];

      expect(apres(3).pourcentage).toBe(50);
      expect(apres(5)).toMatchObject({ montant: 5_000, pourcentage: 83 });
      // La première tranche est soldée : la suivante prend la place.
      expect(apres(6)).toMatchObject({ ordreTranche: 2, pourcentage: 0 });
    });

    it('ne propose jamais un plancher au-dessus du reste', () => {
      // Il ne reste que 300 F sur la dernière tranche : on doit pouvoir les
      // régler, quel que soit le plancher habituel.
      const [derniere] = pour(49_700);

      expect(derniere).toMatchObject({ montant: 300, montantMin: 300 });
    });
  });

  describe('versements en attente de validation', () => {
    it('compte déjà ce qui est engagé : on ne paie pas deux fois la même part', () => {
      // 5 000 réglés, 10 000 en attente (justificatif non encore validé).
      const [premiere] = pour(5_000, 10_000);

      expect(premiere).toMatchObject({
        montant: 15_000,
        regle: 5_000,
        enAttente: 10_000,
        // Le pourcentage reste celui du réellement réglé.
        pourcentage: 17,
      });
    });

    it('permet d’en lancer plusieurs sans attendre la trésorerie', () => {
      // Un premier justificatif de 5 000 attend : on peut en déposer un autre,
      // sur ce qu'il reste.
      const [premiere] = pour(0, 5_000);

      expect(premiere.payable).toBe(true);
      expect(premiere.montant).toBe(25_000);
    });

    it('passe à la tranche suivante quand la première est entièrement couverte', () => {
      // 30 000 en attente : la tranche 1 n'a plus rien à recevoir.
      const echeances = pour(0, 30_000);

      expect(echeances[0]).toMatchObject({ ordreTranche: 2, payable: true });
      expect(echeances.map((e) => e.ordreTranche)).not.toContain(1);
    });

    it('ne propose plus rien quand tout est déjà engagé', () => {
      expect(pour(20_000, 30_000)).toEqual([]);
    });
  });

  describe('tout le reste', () => {
    it('vaut le reste dû, jamais le montant d’origine', () => {
      const totalite = pour(15_000).find((e) => e.ordreTranche === null)!;

      expect(totalite.libelle).toBe(LIBELLE_TOTALITE);
      expect(totalite.montant).toBe(35_000);
      expect(totalite.montantEcheance).toBe(50_000);
      expect(totalite.pourcentage).toBe(30);
    });

    it('est un montant fixe, et close à la clôture de la cotisation', () => {
      const totalite = pour(0).find((e) => e.ordreTranche === null)!;

      expect(totalite.libre).toBe(false);
      expect(totalite.dateLimite).toBe('2099-06-30T00:00:00.000Z');
    });

    it('déduit ce qui attend sa validation', () => {
      const totalite = pour(10_000, 5_000).find(
        (e) => e.ordreTranche === null,
      )!;

      expect(totalite.montant).toBe(35_000);
      expect(totalite.enAttente).toBe(5_000);
    });

    it('n’affiche pas deux fois le même paiement', () => {
      // Il ne reste que la dernière tranche : elle vaut tout le reste.
      expect(pour(45_000).map((e) => e.ordreTranche)).toEqual([3]);
    });
  });

  describe('selon la cotisation', () => {
    it('ne propose que le reste d’un tenant sans fractionnement', () => {
      const [seule, ...autres] = pour(0, 0, { fractionnable: false });

      expect(autres).toEqual([]);
      expect(seule).toMatchObject({ ordreTranche: null, libre: false });
    });

    it('laisse verser librement sur le reste quand il n’y a pas de tranches', () => {
      const [seule] = pour(0, 0, {}, []);

      expect(seule).toMatchObject({
        ordreTranche: null,
        libelle: LIBELLE_VERSEMENT_LIBRE,
        libre: true,
        montant: 50_000,
      });
    });

    it('ne propose rien une fois soldée', () => {
      expect(pour(50_000)).toEqual([]);
    });

    it('ne laisse rien payer sur une cotisation close', () => {
      expect(pour(0, 0, { ouverte: false }).every((e) => !e.payable)).toBe(
        true,
      );
    });

    it('verrouille les tranches suivantes tant que la première n’est pas couverte', () => {
      const echeances = pour(0);

      expect(echeances.map((e) => [e.ordreTranche, e.payable])).toEqual([
        [1, true],
        [2, false],
        [3, false],
        [null, true],
      ]);
    });
  });

  describe('frais', () => {
    it('chiffre les frais par opérateur, en plus du montant', () => {
      const [premiere] = pour(0);

      expect(premiere.frais.ORANGE_MONEY.prixBase).toBe(30_000);
      expect(premiere.frais.ORANGE_MONEY.montantTtc).toBeGreaterThan(30_000);
      expect(premiere.frais.MTN_MOMO.montantTtc).toBeGreaterThan(
        premiere.frais.ORANGE_MONEY.montantTtc,
      );
    });
  });
});

describe('montantAutorise', () => {
  const tranche = { montant: 25_000, montantMin: 500, libre: true };
  const totalite = { montant: 35_000, montantMin: 500, libre: false };

  it('prend tout le reste de l’échéance quand aucun montant n’est donné', () => {
    expect(montantAutorise(tranche)).toEqual({ montant: 25_000 });
  });

  it('accepte tout montant de la tranche, du plancher à son reste', () => {
    expect(montantAutorise(tranche, 500)).toEqual({ montant: 500 });
    expect(montantAutorise(tranche, 5_000)).toEqual({ montant: 5_000 });
    expect(montantAutorise(tranche, 25_000)).toEqual({ montant: 25_000 });
  });

  it('refuse plus que ce qu’il reste, en le disant', () => {
    expect(montantAutorise(tranche, 25_001)).toEqual({
      erreur: expect.stringContaining('25000') as string,
    });
  });

  it('refuse moins que le plancher', () => {
    expect(montantAutorise(tranche, 499)).toEqual({
      erreur: expect.stringContaining('minimal') as string,
    });
  });

  it('refuse un montant qui n’est pas un entier de francs', () => {
    expect(montantAutorise(tranche, 1_000.5)).toHaveProperty('erreur');
    expect(montantAutorise(tranche, 0)).toHaveProperty('erreur');
  });

  it('exige le montant exact pour « tout le reste »', () => {
    expect(montantAutorise(totalite, 35_000)).toEqual({ montant: 35_000 });
    expect(montantAutorise(totalite, 10_000)).toEqual({
      erreur: expect.stringContaining('en une fois') as string,
    });
  });
});
