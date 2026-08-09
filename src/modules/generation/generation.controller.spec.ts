import { Generation } from './entities/generation.entity';
import { GenerationController } from './generation.controller';
import { GenerationService } from './generation.service';
import { IdentiteVisuelleService } from './identite-visuelle.service';

/**
 * Le cache de la charte tient cinq minutes. Sans invalidation, un changement
 * de couleur ou de logo mettrait ce délai à se voir dans les messages — assez
 * pour qu'un bureau conclue que le réglage n'a pas fonctionné et le refasse.
 */
describe('GenerationController — invalidation de la charte', () => {
  let controller: GenerationController;
  let invalider: jest.Mock;
  let generationService: {
    mettreAJour: jest.Mock;
    designerLogo: jest.Mock;
    activer: jest.Mock;
  };

  const generation = (isActive: boolean): Generation =>
    ({ id: 'gen-1', isActive }) as Generation;

  beforeEach(() => {
    invalider = jest.fn();
    generationService = {
      mettreAJour: jest.fn().mockResolvedValue(generation(true)),
      designerLogo: jest.fn().mockResolvedValue(generation(true)),
      activer: jest.fn().mockResolvedValue(generation(true)),
    };

    controller = new GenerationController(
      generationService as unknown as GenerationService,
      { invalider } as unknown as IdentiteVisuelleService,
    );
  });

  it('vide le cache quand le mandat en cours change de couleurs', async () => {
    await controller.mettreAJour('gen-1', { couleurPrimaire: '#123456' });

    expect(invalider).toHaveBeenCalledTimes(1);
  });

  it('vide le cache quand le logo affiché change', async () => {
    await controller.designerLogo('gen-1', { logo: 'generations/atlas.png' });

    expect(invalider).toHaveBeenCalledTimes(1);
  });

  it('vide le cache à la passation', async () => {
    await controller.activer('gen-1');

    expect(invalider).toHaveBeenCalledTimes(1);
  });

  it('épargne le cache quand la génération retouchée n’est pas en cours', async () => {
    // Une génération inactive n'habille rien : forcer une relecture de la base
    // et du stockage ne servirait à personne.
    generationService.mettreAJour.mockResolvedValue(generation(false));

    await controller.mettreAJour('gen-1', { nom: 'ATLAS' });

    expect(invalider).not.toHaveBeenCalled();
  });
});
