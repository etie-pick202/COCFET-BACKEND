import { ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { BureauService } from '../bureau/bureau.service';
import { Stockage } from '../file/ports/stockage';
import { Generation } from './entities/generation.entity';
import { GenerationService } from './generation.service';

/**
 * Les déclinaisons de logo d'un mandat.
 *
 * Le point qui compte : **retirer une déclinaison efface l'objet du stockage**.
 * La conserver laisserait un fichier payant que plus rien ne référence, et
 * qu'aucune purge ne saurait distinguer d'un objet encore utile.
 */
describe('GenerationService — déclinaisons de logo', () => {
  let service: GenerationService;
  let generations: jest.Mocked<Pick<Repository<Generation>, 'findOne'>> & {
    update: jest.Mock;
  };
  let supprimer: jest.Mock;

  let enBase: Generation;

  const mandat = (surcharge: Partial<Generation> = {}): Generation =>
    ({
      id: 'aa11',
      nom: 'ATLAS',
      annee: 2027,
      logo: null,
      logos: [],
      archivedAt: null,
      ...surcharge,
    }) as Generation;

  beforeEach(() => {
    enBase = mandat();
    supprimer = jest.fn().mockResolvedValue(undefined);

    generations = {
      findOne: jest.fn().mockImplementation(() => Promise.resolve(enBase)),
      // La mise à jour est appliquée au double : les méthodes relisent la
      // génération après écriture, et un double figé masquerait le résultat.
      update: jest
        .fn()
        .mockImplementation((_id, champs: Partial<Generation>) => {
          enBase = { ...enBase, ...champs };
          return Promise.resolve({ affected: 1 });
        }),
    };

    service = new GenerationService(
      generations as unknown as Repository<Generation>,
      {} as DataSource,
      {} as BureauService,
      { supprimer } as unknown as Stockage,
    );
  });

  describe('rattacher', () => {
    it('ajoute une déclinaison', async () => {
      const apres = await service.ajouterLogo('aa11', 'logos/clair.png');

      expect(apres.logos).toEqual(['logos/clair.png']);
    });

    it('ne duplique pas une clé déjà rattachée', async () => {
      // Le frontend doit pouvoir rejouer l'appel après une coupure réseau.
      enBase = mandat({ logos: ['logos/clair.png'] });

      const apres = await service.ajouterLogo('aa11', 'logos/clair.png');

      expect(apres.logos).toEqual(['logos/clair.png']);
      expect(generations.update).not.toHaveBeenCalled();
    });

    it('refuse au-delà du plafond', async () => {
      enBase = mandat({
        logos: Array.from({ length: 10 }, (_, i) => `logos/${i}.png`),
      });

      await expect(
        service.ajouterLogo('aa11', 'logos/de-trop.png'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('retirer', () => {
    it('efface l’objet du stockage, pas seulement la référence', async () => {
      enBase = mandat({ logos: ['logos/clair.png', 'logos/sombre.png'] });

      const apres = await service.retirerLogo('aa11', 'logos/clair.png');

      expect(apres.logos).toEqual(['logos/sombre.png']);
      expect(supprimer).toHaveBeenCalledWith('logos/clair.png');
    });

    it('lève la désignation quand c’est le logo en service', async () => {
      // La plateforme retombe sur ses couleurs neutres plutôt que de pointer
      // vers un objet effacé.
      enBase = mandat({
        logos: ['logos/clair.png'],
        logo: 'logos/clair.png',
      });

      const apres = await service.retirerLogo('aa11', 'logos/clair.png');

      expect(apres.logos).toEqual([]);
      expect(apres.logo).toBeNull();
    });

    it('laisse intacte la désignation d’une autre déclinaison', async () => {
      enBase = mandat({
        logos: ['logos/clair.png', 'logos/sombre.png'],
        logo: 'logos/sombre.png',
      });

      const apres = await service.retirerLogo('aa11', 'logos/clair.png');

      expect(apres.logo).toBe('logos/sombre.png');
    });

    it('refuse une déclinaison jamais déposée', async () => {
      enBase = mandat({ logos: ['logos/clair.png'] });

      await expect(
        service.retirerLogo('aa11', 'logos/jamais-vue.png'),
      ).rejects.toThrow(NotFoundException);
      expect(supprimer).not.toHaveBeenCalled();
    });

    it('écrit en base avant d’effacer du stockage', async () => {
      // Dans l'autre sens, un échec de la base après un effacement réussi
      // laisserait le mandat pointant vers un objet disparu — une image cassée
      // sur le site, dans les emails et dans les documents.
      const ordre: string[] = [];
      generations.update.mockImplementation(() => {
        ordre.push('base');
        return Promise.resolve({ affected: 1 });
      });
      supprimer.mockImplementation(() => {
        ordre.push('stockage');
        return Promise.resolve();
      });
      enBase = mandat({ logos: ['logos/clair.png'] });

      await service.retirerLogo('aa11', 'logos/clair.png');

      expect(ordre).toEqual(['base', 'stockage']);
    });

    it('retire la déclinaison même si le stockage refuse', async () => {
      // C'est ce que le bureau a demandé ; l'objet restera orphelin, ce que le
      // journal permet de rattraper.
      enBase = mandat({ logos: ['logos/clair.png'] });
      supprimer.mockRejectedValue(new Error('objet absent'));

      const apres = await service.retirerLogo('aa11', 'logos/clair.png');

      expect(apres.logos).toEqual([]);
    });
  });
});
