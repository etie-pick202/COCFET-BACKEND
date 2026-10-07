import {
  StatutMouvementFonds as Statut,
  TypeMouvementFonds as Type,
} from './entities/mouvement-fonds.entity';
import { calculerPoches, disponible, MouvementPourPoche } from './poches';

const noms = new Map([
  ['x', 'Awa Ngassa'],
  ['y', 'Paul Biya'],
]);

const mouvement = (
  surcharge: Partial<MouvementPourPoche>,
): MouvementPourPoche => ({
  type: Type.RECEPTION,
  statut: Statut.VALIDE,
  montant: 1000,
  membreId: 'x',
  contrepartieId: null,
  ...surcharge,
});

const poche = (id: string, entrees: Parameters<typeof calculerPoches>[0]) =>
  calculerPoches(entrees).find((p) => p.membre.id === id);

const vide = { mouvements: [], preuves: [], retraits: [], noms };

describe('calculerPoches', () => {
  it('compte les preuves validées et les réceptions comme de l’argent reçu', () => {
    const resultat = poche('x', {
      ...vide,
      preuves: [{ membreId: 'x', montant: 30_000 }],
      mouvements: [mouvement({ montant: 5_000 })],
    });

    expect(resultat).toMatchObject({ recu: 35_000, detient: 35_000 });
  });

  it('attribue un retrait Fapshi à la poche de celui qui l’a reçu', () => {
    const resultat = poche('y', {
      ...vide,
      retraits: [{ membreId: 'y', montant: 12_000 }],
    });

    expect(resultat).toMatchObject({ retire: 12_000, detient: 12_000 });
  });

  it('déplace l’argent d’une poche à l’autre sans en créer', () => {
    const entrees = {
      ...vide,
      preuves: [{ membreId: 'x', montant: 20_000 }],
      mouvements: [
        mouvement({
          type: Type.TRANSFERT,
          montant: 8_000,
          membreId: 'x',
          contrepartieId: 'y',
        }),
      ],
    };

    expect(poche('x', entrees)?.detient).toBe(12_000);
    expect(poche('y', entrees)?.detient).toBe(8_000);
    expect(poche('y', entrees)?.transfertsRecus).toBe(8_000);
  });

  it.each([Type.DEPOT_PLATEFORME, Type.REMBOURSEMENT, Type.DEPENSE])(
    'fait sortir de la poche : %s',
    (type) => {
      const resultat = poche('x', {
        ...vide,
        preuves: [{ membreId: 'x', montant: 10_000 }],
        mouvements: [mouvement({ type, montant: 4_000 })],
      });

      expect(resultat).toMatchObject({ sorti: 4_000, detient: 6_000 });
    },
  );

  it('réserve un dépôt en attente sans encore le retirer de la poche', () => {
    const resultat = poche('x', {
      ...vide,
      preuves: [{ membreId: 'x', montant: 10_000 }],
      mouvements: [
        mouvement({
          type: Type.DEPOT_PLATEFORME,
          statut: Statut.EN_ATTENTE,
          montant: 4_000,
        }),
      ],
    });

    expect(resultat).toMatchObject({ detient: 10_000, enRoute: 4_000 });
    expect(disponible(resultat)).toBe(6_000);
  });

  it('ignore un mouvement échoué', () => {
    const resultat = poche('x', {
      ...vide,
      preuves: [{ membreId: 'x', montant: 10_000 }],
      mouvements: [
        mouvement({
          type: Type.DEPOT_PLATEFORME,
          statut: Statut.ECHOUE,
          montant: 4_000,
        }),
      ],
    });

    expect(resultat).toMatchObject({ detient: 10_000, sorti: 0, enRoute: 0 });
  });

  it('laisse apparaître une poche négative plutôt que de la cacher', () => {
    const resultat = poche('x', {
      ...vide,
      mouvements: [mouvement({ type: Type.DEPENSE, montant: 3_000 })],
    });

    expect(resultat?.detient).toBe(-3_000);
  });

  it('classe de la poche la plus pleine à la plus vide', () => {
    const resultat = calculerPoches({
      ...vide,
      preuves: [
        { membreId: 'x', montant: 1_000 },
        { membreId: 'y', montant: 9_000 },
      ],
    });

    expect(resultat.map((p) => p.membre.nom)).toEqual([
      'Paul Biya',
      'Awa Ngassa',
    ]);
  });

  it('ne dispose de rien pour un membre sans poche', () => {
    expect(disponible(undefined)).toBe(0);
  });
});
