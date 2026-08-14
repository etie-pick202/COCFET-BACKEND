import { Repository } from 'typeorm';
import { NettoyageFichiers } from '../file/nettoyage-fichiers.service';
import { RepercussionPaiementService } from '../paiement/repercussion-paiement.service';
import { TransactionService } from '../paiement/transaction.service';
import { JustificatifPaiement } from './entities/justificatif-paiement.entity';
import { JustificatifService } from './justificatif.service';
import { PurgeJustificatifsService } from './purge-justificatifs.service';

/**
 * Purge des captures au-delà de deux mois.
 *
 * Le point qui compte : **la décision survit à l'image**. Ce qui vaut à long
 * terme est qu'un paiement a été reconnu, par qui et quand ; la capture, elle,
 * est un relevé qui ne nous appartient pas et dont l'usage a cessé.
 */
describe('JustificatifService — purge', () => {
  let service: JustificatifService;
  let justificatifs: { find: jest.Mock; update: jest.Mock };
  let retirer: jest.Mock;

  const piece = (surcharge: Partial<JustificatifPaiement> = {}) =>
    ({
      id: 'j1',
      cle: 'justificatifs/a.png',
      ...surcharge,
    }) as JustificatifPaiement;

  beforeEach(() => {
    retirer = jest.fn().mockResolvedValue(undefined);
    justificatifs = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    service = new JustificatifService(
      justificatifs as unknown as Repository<JustificatifPaiement>,
      {} as TransactionService,
      {} as RepercussionPaiementService,
      { retirer } as unknown as NettoyageFichiers,
    );
  });

  it('efface les captures périmées et vide leur clé', async () => {
    justificatifs.find.mockResolvedValue([
      piece({ id: 'j1', cle: 'justificatifs/a.png' }),
      piece({ id: 'j2', cle: 'justificatifs/b.png' }),
    ]);

    const effacees = await service.purger();

    expect(effacees).toBe(2);
    expect(retirer).toHaveBeenCalledWith(
      'justificatifs/a.png',
      'justificatifs/b.png',
    );
    // La ligne demeure : c'est la décision qu'on conserve, pas l'image.
    expect(justificatifs.update).toHaveBeenCalledWith(['j1', 'j2'], {
      cle: null,
    });
  });

  it('ne touche pas aux pièces déjà purgées', async () => {
    // Leur clé est nulle : il n'y a plus rien à effacer, et redemander au
    // stockage produirait un avertissement à chaque nuit.
    justificatifs.find.mockResolvedValue([piece({ cle: null })]);

    await expect(service.purger()).resolves.toBe(0);
    expect(retirer).not.toHaveBeenCalled();
    expect(justificatifs.update).not.toHaveBeenCalled();
  });

  it('ne fait rien quand rien n’est périmé', async () => {
    await expect(service.purger()).resolves.toBe(0);
    expect(retirer).not.toHaveBeenCalled();
  });

  it('ne cherche que les pièces plus vieilles que deux mois', async () => {
    await service.purger();

    const [{ where }] = justificatifs.find.mock.calls[0] as [
      { where: { createdAt: { value: Date } } },
    ];
    const limite = where.createdAt.value.getTime();
    const attendue = Date.now() - 60 * 24 * 60 * 60 * 1000;

    // À la seconde près : le test ne doit pas dépendre de sa propre durée.
    expect(Math.abs(limite - attendue)).toBeLessThan(5000);
  });
});

describe('PurgeJustificatifsService', () => {
  it('ne laisse pas un échec faire tomber la tâche planifiée', async () => {
    // Sans cela, une purge ratée emporterait la planification et plus rien ne
    // serait jamais purgé ensuite.
    const purger = jest.fn().mockRejectedValue(new Error('stockage muet'));
    const tache = new PurgeJustificatifsService({
      purger,
    } as unknown as JustificatifService);

    await expect(tache.purger()).resolves.toBeUndefined();
    expect(purger).toHaveBeenCalled();
  });

  it('délègue la purge au service métier', async () => {
    const purger = jest.fn().mockResolvedValue(3);
    const tache = new PurgeJustificatifsService({
      purger,
    } as unknown as JustificatifService);

    await tache.purger();

    expect(purger).toHaveBeenCalledTimes(1);
  });
});
