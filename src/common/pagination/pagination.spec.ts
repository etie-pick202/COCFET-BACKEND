// class-validator lit les décorateurs par réflexion : sans ce polyfill, chargé
// ailleurs par le bootstrap Nest, les règles de validation sont invisibles et
// tout passe.
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LIMITE_MAXIMALE, PaginationDto, triAutorise } from './pagination.dto';
import { paginer } from './resultat-pagine';

const valider = (brut: Record<string, unknown>) => {
  const dto = plainToInstance(PaginationDto, brut, {
    enableImplicitConversion: false,
  });
  return { dto, erreurs: validateSync(dto) };
};

describe('PaginationDto', () => {
  it('applique des valeurs par défaut quand rien n’est fourni', () => {
    const { dto, erreurs } = valider({});

    expect(erreurs).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.limite).toBe(20);
    expect(dto.ordre).toBe('DESC');
    expect(dto.sauter).toBe(0);
  });

  it('convertit les paramètres de requête, qui arrivent en chaînes', () => {
    const { dto, erreurs } = valider({ page: '3', limite: '10' });

    expect(erreurs).toHaveLength(0);
    expect(dto.page).toBe(3);
    expect(dto.sauter).toBe(20);
  });

  it('refuse une limite au-delà du plafond', () => {
    const { erreurs } = valider({ limite: String(LIMITE_MAXIMALE + 1) });

    expect(erreurs).toHaveLength(1);
    expect(erreurs[0].property).toBe('limite');
  });

  it('refuse une page nulle ou négative', () => {
    expect(valider({ page: '0' }).erreurs).toHaveLength(1);
    expect(valider({ page: '-2' }).erreurs).toHaveLength(1);
  });

  it('accepte l’ordre en minuscules', () => {
    const { dto, erreurs } = valider({ ordre: 'asc' });

    expect(erreurs).toHaveLength(0);
    expect(dto.ordre).toBe('ASC');
  });

  it.each([
    'nom; DROP TABLE users',
    'nom OR 1=1',
    '(SELECT 1)',
    '1nom',
    "nom'",
  ])('rejette « %s » comme champ de tri', (tri) => {
    const { erreurs } = valider({ tri });

    expect(erreurs).toHaveLength(1);
    expect(erreurs[0].property).toBe('tri');
  });
});

describe('triAutorise', () => {
  const COLONNES = ['createdAt', 'nom'] as const;

  it('retient le tri demandé lorsqu’il figure dans la liste blanche', () => {
    expect(triAutorise('nom', COLONNES, 'createdAt')).toBe('nom');
  });

  it('retombe sur la colonne par défaut pour un champ inconnu', () => {
    // Le filtre syntaxique du DTO laisse passer n'importe quel identifiant
    // bien formé : c'est cette confrontation qui ferme réellement la porte.
    expect(triAutorise('passwordHash', COLONNES, 'createdAt')).toBe(
      'createdAt',
    );
    expect(triAutorise(undefined, COLONNES, 'createdAt')).toBe('createdAt');
  });
});

describe('paginer', () => {
  const pagination = (page: number, limite: number) =>
    plainToInstance(PaginationDto, { page, limite });

  it('calcule les métadonnées d’une page intermédiaire', () => {
    const resultat = paginer([['a', 'b'], 25], pagination(2, 10));

    expect(resultat.meta).toEqual({
      page: 2,
      limite: 10,
      total: 25,
      totalPages: 3,
      aSuivante: true,
      aPrecedente: true,
    });
  });

  it('n’annonce pas de page suivante quand la dernière est pleine', () => {
    // Le cas piège : 20 éléments sur des pages de 10, la page 2 est pleine
    // mais rien ne suit.
    expect(paginer([[], 20], pagination(2, 10)).meta.aSuivante).toBe(false);
  });

  it('reste cohérent sur un ensemble vide', () => {
    expect(paginer([[], 0], pagination(1, 10)).meta).toMatchObject({
      total: 0,
      totalPages: 0,
      aSuivante: false,
      aPrecedente: false,
    });
  });
});
