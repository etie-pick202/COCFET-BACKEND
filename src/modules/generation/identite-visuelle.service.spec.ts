import { Stockage } from '../file/ports/stockage';
import { Generation } from './entities/generation.entity';
import { GenerationService } from './generation.service';
import { IdentiteVisuelleService } from './identite-visuelle.service';

describe('IdentiteVisuelleService', () => {
  let service: IdentiteVisuelleService;
  let trouverActive: jest.Mock;
  let telecharger: jest.Mock;

  const mandat = (surcharge: Partial<Generation> = {}): Generation =>
    ({
      nom: 'Promotion ATLAS',
      annee: 2027,
      couleurPrimaire: '#123456',
      couleurSecondaire: '#ABCDEF',
      logo: 'generations/atlas.png',
      ...surcharge,
    }) as Generation;

  beforeEach(() => {
    trouverActive = jest.fn().mockResolvedValue(mandat());
    telecharger = jest.fn().mockResolvedValue(Buffer.from('png'));

    service = new IdentiteVisuelleService(
      { trouverActive } as unknown as GenerationService,
      { telecharger } as unknown as Stockage,
    );
  });

  it('rend la charte du mandat, logo compris', async () => {
    const charte = await service.charte();

    expect(charte).toMatchObject({
      nom: 'Promotion ATLAS',
      annee: 2027,
      couleurPrimaire: '#123456',
    });
    expect(charte.logo?.toString()).toBe('png');
  });

  it('ne relit ni la base ni le stockage au second appel', async () => {
    // Une diffusion à trois cents personnes ne doit pas produire trois cents
    // lectures d'un logo qui change une fois par mandat.
    await service.charte();
    await service.charte();

    expect(trouverActive).toHaveBeenCalledTimes(1);
    expect(telecharger).toHaveBeenCalledTimes(1);
  });

  it('relit après invalidation', async () => {
    await service.charte();
    service.invalider();
    await service.charte();

    expect(trouverActive).toHaveBeenCalledTimes(2);
  });

  it('retombe sur des couleurs neutres sans mandat actif', async () => {
    // Plateforme fraîchement installée, ou entre deux mandats : les messages
    // doivent partir quand même.
    trouverActive.mockResolvedValue(null);

    const charte = await service.charte();

    expect(charte.nom).toBe('COCFET');
    expect(charte.logo).toBeNull();
    expect(telecharger).not.toHaveBeenCalled();
  });

  it('part sans image plutôt que d’échouer si le logo est illisible', async () => {
    telecharger.mockRejectedValue(new Error('objet absent'));

    const charte = await service.charte();

    expect(charte.logo).toBeNull();
    expect(charte.nom).toBe('Promotion ATLAS');
  });

  it('n’interroge pas le stockage quand aucun logo n’est désigné', async () => {
    trouverActive.mockResolvedValue(mandat({ logo: null }));

    await expect(service.charte()).resolves.toMatchObject({ logo: null });
    expect(telecharger).not.toHaveBeenCalled();
  });

  it('remplace une couleur qui n’en est pas une', async () => {
    // La colonne est un `varchar` libre. Posée telle quelle dans un attribut
    // `style`, une saisie de cette forme porterait autre chose qu'une couleur.
    trouverActive.mockResolvedValue(
      mandat({ couleurPrimaire: 'red; background-image: url(//pister.test)' }),
    );

    const charte = await service.charte();

    expect(charte.couleurPrimaire).toBe('#0F172A');
    expect(charte.couleurSecondaire).toBe('#ABCDEF');
  });

  it('choisit un texte lisible sur le fond du mandat', async () => {
    // Un bureau peut choisir un jaune vif : du blanc dessus ne se lit plus.
    trouverActive.mockResolvedValue(mandat({ couleurPrimaire: '#FFD400' }));
    await expect(service.charte()).resolves.toMatchObject({
      contrastePrimaire: '#111827',
    });

    service.invalider();
    trouverActive.mockResolvedValue(mandat({ couleurPrimaire: '#0F172A' }));
    await expect(service.charte()).resolves.toMatchObject({
      contrastePrimaire: '#FFFFFF',
    });
  });

  it('survit à une base indisponible', async () => {
    // Une charte manquante dégrade l'apparence d'un message ; elle ne doit
    // pas empêcher son envoi.
    trouverActive.mockRejectedValue(new Error('base injoignable'));

    await expect(service.charte()).resolves.toMatchObject({ nom: 'COCFET' });
  });
});
