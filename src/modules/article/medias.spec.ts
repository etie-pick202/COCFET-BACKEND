import { normaliserCategorie, cleDeCategorie } from './categorie';
import { clesDeMedias, mediasRetires } from './medias';

describe('clesDeMedias', () => {
  it('relève images et vidéos du texte, sans doublon', () => {
    const texte =
      'Intro ![a](articles/a.png) puis ![v](videos/v.mp4) et ![a](articles/a.png)';

    expect(clesDeMedias(texte)).toEqual(['articles/a.png', 'videos/v.mp4']);
  });

  it('ignore les adresses extérieures et les dossiers inattendus', () => {
    const texte =
      '![x](https://exemple.com/x.png) ![y](cv/secret.pdf) ![z](../articles/z.png)';

    expect(clesDeMedias(texte)).toEqual([]);
  });

  it('ne lit pas un lien ordinaire comme un média', () => {
    expect(clesDeMedias('[page](articles/a.png)')).toEqual([]);
  });

  it('supporte un texte absent', () => {
    expect(clesDeMedias(null)).toEqual([]);
    expect(clesDeMedias(undefined)).toEqual([]);
  });
});

describe('mediasRetires', () => {
  it('rend ce que le texte citait avant et ne cite plus', () => {
    expect(
      mediasRetires(
        '![a](articles/a.png) ![b](articles/b.png)',
        '![b](articles/b.png)',
      ),
    ).toEqual(['articles/a.png']);
  });

  it('ne rend rien quand rien n’est retiré', () => {
    expect(
      mediasRetires('![a](articles/a.png)', '![a](articles/a.png)!'),
    ).toEqual([]);
  });
});

describe('normaliserCategorie', () => {
  it('rend null pour une saisie vide ou blanche', () => {
    expect(normaliserCategorie('   ', [])).toBeNull();
    expect(normaliserCategorie(undefined, [])).toBeNull();
  });

  it('reprend l’orthographe existante, à la casse et aux accents près', () => {
    expect(normaliserCategorie('vie  du CAMPUS', ['Vie du campus'])).toBe(
      'Vie du campus',
    );
    expect(normaliserCategorie('evenements', ['Événements'])).toBe(
      'Événements',
    );
  });

  it('met une majuscule à une catégorie nouvelle', () => {
    expect(normaliserCategorie('  sport ', ['Vie du campus'])).toBe('Sport');
  });

  it('compare sans accents ni casse', () => {
    expect(cleDeCategorie('  Événements ')).toBe('evenements');
  });
});
