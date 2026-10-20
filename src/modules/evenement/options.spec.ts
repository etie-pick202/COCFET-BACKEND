import { BadRequestException } from '@nestjs/common';
import {
  cleDepuisLibelle,
  conflitsAvecLesChoix,
  dateFigeage,
  lireUtilisations,
  normaliserOptions,
  OptionEvenement,
  reponsesCompletes,
  validerReponses,
} from './options';

const TAILLES: OptionEvenement[] = [
  {
    cle: 'taille',
    libelle: 'Taille de T-shirt',
    obligatoire: true,
    choix: [
      { valeur: 'M', stock: 2 },
      { valeur: 'L', stock: null },
    ],
  },
];

describe('cleDepuisLibelle', () => {
  it('retire accents, casse et ponctuation', () => {
    expect(cleDepuisLibelle('Taille de T-shirt')).toBe('taille-de-t-shirt');
    expect(cleDepuisLibelle('Régime  alimentaire !')).toBe(
      'regime-alimentaire',
    );
  });

  it('retombe sur « option » quand rien ne reste', () => {
    expect(cleDepuisLibelle('???')).toBe('option');
  });

  it('borne la longueur', () => {
    expect(cleDepuisLibelle('a'.repeat(100)).length).toBeLessThanOrEqual(30);
  });
});

describe('normaliserOptions', () => {
  it('nettoie les textes et écarte les valeurs en double', () => {
    const [option] = normaliserOptions([
      {
        libelle: '  Taille   de T-shirt ',
        obligatoire: true,
        choix: [
          { valeur: ' XL ' },
          { valeur: 'xl' },
          { valeur: 'M', stock: 3 },
          { valeur: '  ' },
        ],
      },
    ]);

    expect(option).toEqual({
      cle: 'taille-de-t-shirt',
      libelle: 'Taille de T-shirt',
      obligatoire: true,
      choix: [
        { valeur: 'XL', stock: null },
        { valeur: 'M', stock: 3 },
      ],
    });
  });

  it('rend les clés uniques', () => {
    const options = normaliserOptions([
      { libelle: 'Taille', choix: [{ valeur: 'M' }] },
      { libelle: 'Taille', choix: [{ valeur: 'L' }] },
    ]);

    expect(options.map((o) => o.cle)).toEqual(['taille', 'taille-2']);
  });

  it('rend une option facultative par défaut', () => {
    expect(
      normaliserOptions([{ libelle: 'Menu', choix: [{ valeur: 'Végé' }] }])[0]
        .obligatoire,
    ).toBe(false);
  });

  it('refuse une option sans choix, ou sans intitulé', () => {
    expect(() =>
      normaliserOptions([{ libelle: 'Taille', choix: [{ valeur: ' ' }] }]),
    ).toThrow(BadRequestException);
    expect(() =>
      normaliserOptions([{ libelle: '  ', choix: [{ valeur: 'M' }] }]),
    ).toThrow(BadRequestException);
  });

  it('refuse trop d’options ou trop de choix', () => {
    const option = { libelle: 'x', choix: [{ valeur: 'a' }] };
    expect(() =>
      normaliserOptions(Array.from({ length: 6 }, () => option)),
    ).toThrow(BadRequestException);
    expect(() =>
      normaliserOptions([
        {
          libelle: 'Taille',
          choix: Array.from({ length: 21 }, (_, i) => ({ valeur: `v${i}` })),
        },
      ]),
    ).toThrow(BadRequestException);
  });

  it('accepte une liste vide : aucune option', () => {
    expect(normaliserOptions([])).toEqual([]);
  });
});

describe('validerReponses', () => {
  it('accepte une valeur proposée', () => {
    expect(validerReponses(TAILLES, { taille: 'M' }, true)).toEqual({
      taille: 'M',
    });
  });

  it('exige les options obligatoires', () => {
    expect(() => validerReponses(TAILLES, {}, true)).toThrow(
      'Choisissez : Taille de T-shirt.',
    );
    expect(() => validerReponses(TAILLES, undefined, true)).toThrow(
      BadRequestException,
    );
  });

  it('ne les exige pas quand on ne le demande pas', () => {
    expect(validerReponses(TAILLES, undefined, false)).toEqual({});
  });

  it('refuse une valeur hors liste, y compris du texte libre', () => {
    expect(() => validerReponses(TAILLES, { taille: 'XL' }, true)).toThrow(
      BadRequestException,
    );
    expect(() => validerReponses(TAILLES, { taille: 'm' }, true)).toThrow(
      BadRequestException,
    );
  });

  it('ne laisse jamais le client choisir la propriété écrite', () => {
    const hostile = JSON.parse('{"__proto__": "x", "taille": "M"}') as unknown;

    expect(() => validerReponses(TAILLES, hostile, true)).toThrow(
      'Option inconnue',
    );
    expect(({} as Record<string, unknown>).polluee).toBeUndefined();
  });

  it('refuse une clé inconnue et des réponses qui ne sont pas un objet', () => {
    expect(() => validerReponses(TAILLES, { menu: 'x' }, false)).toThrow(
      'Option inconnue',
    );
    expect(() => validerReponses(TAILLES, ['M'], true)).toThrow(
      BadRequestException,
    );
    expect(() => validerReponses(TAILLES, 'M', true)).toThrow(
      BadRequestException,
    );
    expect(() => validerReponses(TAILLES, { taille: 3 }, true)).toThrow(
      BadRequestException,
    );
  });
});

describe('reponsesCompletes', () => {
  it('est vrai quand toutes les obligatoires ont leur réponse', () => {
    expect(reponsesCompletes(TAILLES, { taille: 'M' })).toBe(true);
    expect(reponsesCompletes(TAILLES, {})).toBe(false);
    expect(reponsesCompletes(TAILLES, null)).toBe(false);
  });

  it('ignore les options facultatives', () => {
    expect(
      reponsesCompletes([{ ...TAILLES[0], obligatoire: false }], undefined),
    ).toBe(true);
  });
});

describe('dateFigeage', () => {
  it('recule du nombre de jours demandé', () => {
    const debut = new Date('2026-11-30T08:00:00.000Z');

    expect(dateFigeage(debut, 3).toISOString()).toBe(
      '2026-11-27T08:00:00.000Z',
    );
    expect(dateFigeage(debut, 0).toISOString()).toBe(debut.toISOString());
  });
});

describe('conflitsAvecLesChoix', () => {
  const utilisations = [
    { cle: 'taille', valeur: 'M', confirmees: 1, enAttente: 1 },
    { cle: 'taille', valeur: 'L', confirmees: 4, enAttente: 0 },
  ];

  it('ne signale rien quand les choix existants tiennent encore', () => {
    expect(conflitsAvecLesChoix(TAILLES, utilisations)).toEqual([]);
  });

  it('signale une valeur retirée alors qu’elle est choisie', () => {
    const sansM: OptionEvenement[] = [
      { ...TAILLES[0], choix: [{ valeur: 'L', stock: null }] },
    ];

    expect(conflitsAvecLesChoix(sansM, utilisations)).toEqual([
      expect.stringContaining('« M »'),
    ]);
  });

  it('signale une option retirée', () => {
    expect(conflitsAvecLesChoix([], utilisations)).toHaveLength(2);
  });

  it('signale un stock inférieur à ce qui est pris', () => {
    const serre: OptionEvenement[] = [
      {
        ...TAILLES[0],
        choix: [
          { valeur: 'M', stock: 1 },
          { valeur: 'L', stock: 2 },
        ],
      },
    ];

    expect(conflitsAvecLesChoix(serre, utilisations)).toHaveLength(2);
  });
});

describe('lireUtilisations', () => {
  it('lit les comptes par valeur, sans compter l’inscription exclue', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([
        { cle: 'taille', valeur: 'M', confirmees: '2', en_attente: '1' },
      ]);

    const resultat = await lireUtilisations({ query } as never, 'e1', 'i1');

    expect(resultat).toEqual([
      { cle: 'taille', valeur: 'M', confirmees: 2, enAttente: 1 },
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('jsonb_each_text'),
      ['e1', 'i1'],
    );
  });
});
