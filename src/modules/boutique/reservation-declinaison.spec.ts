import { Repository } from 'typeorm';
import { Evenement } from '../evenement/entities/evenement.entity';
import { NettoyageFichiers } from '../file/nettoyage-fichiers.service';
import { GenerationService } from '../generation/generation.service';
import { BoutiqueService } from './boutique.service';
import { DeclinaisonProduit } from './entities/declinaison-produit.entity';
import { Produit } from './entities/produit.entity';

/**
 * Réservation d'une quantité sur une déclinaison précise.
 *
 * Le banc de bout en bout couvre les cas nominaux ; restent ici les chemins
 * qu'il n'emprunte pas, dont **la compensation** : quand la déclinaison a
 * accepté mais que le compteur global refuse, la quantité prise doit être
 * rendue, sinon un M disparaîtrait du stock sans qu'aucune commande ne
 * l'explique.
 */
describe('BoutiqueService — réservation par déclinaison', () => {
  let service: BoutiqueService;
  let declinaisons: Record<string, jest.Mock>;
  let produits: Record<string, jest.Mock>;
  let executeDeclinaison: jest.Mock;
  let executeProduit: jest.Mock;

  const constructeur = (execute: jest.Mock) => ({
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute,
  });

  beforeEach(() => {
    executeDeclinaison = jest.fn().mockResolvedValue({ affected: 1 });
    executeProduit = jest.fn().mockResolvedValue({ affected: 1 });

    declinaisons = {
      countBy: jest.fn().mockResolvedValue(1),
      findOne: jest.fn().mockResolvedValue({ id: 'd1' }),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest
        .fn()
        .mockImplementation(() => constructeur(executeDeclinaison)),
    };
    produits = {
      findOne: jest.fn().mockResolvedValue({ id: 'p1', stock: 5 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn().mockImplementation((p: unknown) => p),
      createQueryBuilder: jest
        .fn()
        .mockImplementation(() => constructeur(executeProduit)),
    };

    service = new BoutiqueService(
      produits as unknown as Repository<Produit>,
      {} as Repository<Evenement>,
      declinaisons as unknown as Repository<DeclinaisonProduit>,
      {} as GenerationService,
      {} as NettoyageFichiers,
    );
  });

  it('décrémente la déclinaison avant le compteur global', async () => {
    await service.reserverStock('p1', 2, 'M', 'Noir');

    expect(executeDeclinaison).toHaveBeenCalled();
    expect(executeProduit).toHaveBeenCalled();
  });

  it('refuse quand la déclinaison est épuisée', async () => {
    // Le total peut tenir grâce aux autres tailles : c'est le détail qui
    // tranche.
    executeDeclinaison.mockResolvedValue({ affected: 0 });

    await expect(service.reserverStock('p1', 2, 'M', 'Noir')).resolves.toBe(
      false,
    );
    expect(executeProduit).not.toHaveBeenCalled();
  });

  it('rend la quantité quand le compteur global refuse ensuite', async () => {
    // Le détail et le total ont divergé. Sans compensation, un M
    // disparaîtrait du stock sans qu'aucune commande ne l'explique.
    executeProduit.mockResolvedValue({ affected: 0 });

    await expect(service.reserverStock('p1', 2, 'M', 'Noir')).resolves.toBe(
      false,
    );
    expect(declinaisons.increment).toHaveBeenCalledWith(
      { id: 'd1' },
      'stock',
      2,
    );
  });

  it('ignore le détail quand le produit n’a aucune déclinaison', async () => {
    // Un porte-clés ne se décline pas : son stock global fait foi, et ce
    // chemin doit rester celui d'avant.
    declinaisons.countBy.mockResolvedValue(0);

    await service.reserverStock('p1', 1);

    expect(executeDeclinaison).not.toHaveBeenCalled();
    expect(executeProduit).toHaveBeenCalled();
  });

  it('refuse une combinaison que le produit ne propose pas', async () => {
    // Des déclinaisons existent, mais pas celle-ci : accepter reviendrait à
    // vendre une taille qui n'a jamais été mise en stock.
    declinaisons.findOne.mockResolvedValue(null);

    await service.reserverStock('p1', 1, 'XXL', null);

    expect(executeDeclinaison).not.toHaveBeenCalled();
  });
});
