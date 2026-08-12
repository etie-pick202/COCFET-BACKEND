import { fabriquerSlug, slugLibre } from './slug';

describe('fabriquerSlug', () => {
  it('met le titre en minuscules et remplace les espaces', () => {
    expect(fabriquerSlug('Retour sur le Gala')).toBe('retour-sur-le-gala');
  });

  it('retire les accents sans découper le mot', () => {
    // Sans la décomposition Unicode, « Rétrospective » donnerait
    // « r-trospective » : l'accent serait traité comme un séparateur.
    expect(fabriquerSlug('Rétrospective du mandat')).toBe(
      'retrospective-du-mandat',
    );
  });

  it('réduit la ponctuation à un seul séparateur', () => {
    expect(fabriquerSlug('Bilan 2027 : chiffres, faits & résultats !')).toBe(
      'bilan-2027-chiffres-faits-resultats',
    );
  });

  it('ne laisse pas de séparateur aux extrémités', () => {
    expect(fabriquerSlug('  — Annonce —  ')).toBe('annonce');
  });

  it('borne la longueur sans finir sur un séparateur', () => {
    const slug = fabriquerSlug(`${'mot '.repeat(40)}fin`);

    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug).not.toMatch(/-$/);
  });

  it('retombe sur un slug de repli quand rien n’est exploitable', () => {
    // Un titre entièrement composé d'emojis ne laisse rien derrière lui, et un
    // slug vide produirait une URL se confondant avec la liste des articles.
    expect(fabriquerSlug('🎉🎉🎉')).toBe('article');
    expect(fabriquerSlug('')).toBe('article');
  });
});

describe('slugLibre', () => {
  it('rend le slug tel quel quand il est libre', async () => {
    const estPris = jest.fn().mockResolvedValue(false);

    await expect(slugLibre('Gala des finissants', estPris)).resolves.toBe(
      'gala-des-finissants',
    );
    expect(estPris).toHaveBeenCalledWith('gala-des-finissants');
  });

  it('suffixe jusqu’à trouver libre', async () => {
    // Deux comptes rendus annuels peuvent légitimement porter le même titre.
    const pris = new Set(['bilan-du-mandat', 'bilan-du-mandat-2']);
    const estPris = jest.fn((slug: string) => Promise.resolve(pris.has(slug)));

    await expect(slugLibre('Bilan du mandat', estPris)).resolves.toBe(
      'bilan-du-mandat-3',
    );
  });

  it('tranche par l’horodatage plutôt que de boucler sans fin', async () => {
    // Une base qui répondrait toujours « pris » ne doit pas suspendre la
    // requête indéfiniment.
    const estPris = jest.fn().mockResolvedValue(true);

    const slug = await slugLibre('Annonce', estPris);

    expect(slug).toMatch(/^annonce-\d{10,}$/);
  });
});
