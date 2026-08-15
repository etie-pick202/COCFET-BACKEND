import { OptionSondage } from './entities/option-sondage.entity';
import { Vote } from './entities/vote.entity';
import { depouiller, SEGMENT_SANS_PROMOTION } from './depouillement';

/**
 * Dépouillement nominatif d'un scrutin.
 *
 * Deux points portent le calcul : les pourcentages se rapportent aux **votants
 * du segment** et non à l'ensemble — sans quoi ils ne diraient rien de ce que
 * pense la promotion concernée — et un scrutin à choix multiple compte des
 * **votants**, jamais des choix.
 */
describe('depouiller', () => {
  const option = (id: string, texte: string): OptionSondage =>
    ({ id, texte }) as OptionSondage;

  const GALA = option('o1', 'Gala');
  const SOIREE = option('o2', 'Soirée');

  const vote = (
    prenom: string,
    promotion: number | null,
    options: OptionSondage[],
  ): Vote =>
    ({
      user: { id: `u-${prenom}`, firstName: prenom, lastName: 'X', promotion },
      options,
    }) as Vote;

  it('rend le choix de chaque votant', () => {
    const { bulletins } = depouiller([vote('Awa', 2027, [GALA])]);

    expect(bulletins).toEqual([
      {
        userId: 'u-Awa',
        prenom: 'Awa',
        nom: 'X',
        promotion: 2027,
        choix: [{ id: 'o1', texte: 'Gala' }],
      },
    ]);
  });

  it('rapporte les pourcentages aux votants du segment', () => {
    // Deux promotions de tailles différentes : dire qu'une option pèse un
    // tiers du total ne dirait rien de ce que pense chaque promotion.
    const { repartition } = depouiller([
      vote('Awa', 2027, [GALA]),
      vote('Bineta', 2027, [SOIREE]),
      vote('Cheikh', 2028, [GALA]),
    ]);

    const p2027 = repartition.find((s) => s.segment === '2027');
    const p2028 = repartition.find((s) => s.segment === '2028');

    expect(p2027?.votants).toBe(2);
    expect(p2027?.options.find((o) => o.id === 'o1')?.pourcentage).toBe(50);
    expect(p2028?.options.find((o) => o.id === 'o1')?.pourcentage).toBe(100);
  });

  it('compte des votants et non des choix sur un scrutin multiple', () => {
    const { repartition } = depouiller([vote('Awa', 2027, [GALA, SOIREE])]);
    const p2027 = repartition[0];

    expect(p2027.votants).toBe(1);
    // Les deux options sont à cent pour cent : la seule votante a coché les
    // deux. Additionner les choix donnerait deux votants, et cinquante.
    expect(p2027.options.every((o) => o.pourcentage === 100)).toBe(true);
  });

  it('réunit sous « Visiteurs » ceux qui n’ont pas de promotion', () => {
    const { repartition } = depouiller([vote('Awa', null, [GALA])]);

    expect(repartition[0].segment).toBe(SEGMENT_SANS_PROMOTION);
  });

  it('range les promotions avant les visiteurs', () => {
    // Le bureau lit d'abord les siens.
    const { repartition } = depouiller([
      vote('Awa', null, [GALA]),
      vote('Bineta', 2028, [GALA]),
      vote('Cheikh', 2027, [GALA]),
    ]);

    expect(repartition.map((s) => s.segment)).toEqual([
      '2027',
      '2028',
      SEGMENT_SANS_PROMOTION,
    ]);
  });

  it('classe les options par nombre de voix', () => {
    const { repartition } = depouiller([
      vote('Awa', 2027, [SOIREE]),
      vote('Bineta', 2027, [SOIREE]),
      vote('Cheikh', 2027, [GALA]),
    ]);

    expect(repartition[0].options.map((o) => o.id)).toEqual(['o2', 'o1']);
  });

  it('écarte un bulletin sans auteur', () => {
    // Cas d'un scrutin anonyme : le service refuse avant d'arriver ici, mais
    // le calcul ne doit pas trahir un choix si un tel bulletin lui parvient.
    const anonyme = { user: null, options: [GALA] } as Vote;

    const { bulletins, repartition } = depouiller([anonyme]);

    expect(bulletins).toEqual([]);
    expect(repartition).toEqual([]);
  });

  it('supporte un bulletin sans aucun choix', () => {
    const { repartition } = depouiller([
      {
        user: { id: 'u1', firstName: 'A', lastName: 'B', promotion: 2027 },
      } as Vote,
    ]);

    expect(repartition[0].votants).toBe(1);
    expect(repartition[0].options).toEqual([]);
  });

  it('rend un dépouillement vide sans aucun vote', () => {
    expect(depouiller([])).toEqual({ bulletins: [], repartition: [] });
  });
});
