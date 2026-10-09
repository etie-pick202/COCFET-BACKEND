import { Repository } from 'typeorm';
import { Transaction } from '../paiement/entities/transaction.entity';
import { CanalPaiement } from '../paiement/enums/paiement.enum';
import { TresorerieService } from './tresorerie.service';

/**
 * Le canal dit par où l'argent est arrivé : une preuve de paiement déposée est
 * hors ligne, un montant nul est gratuit, tout le reste est passé par la
 * plateforme. Le journal et l'export le portent.
 */
describe('TresorerieService — canal de paiement', () => {
  const ligne = (reference: string, montant: number) =>
    ({ reference, montant, createdAt: new Date(), user: null }) as Transaction;

  const service = (transactions: Transaction[], avecPreuve: string[]) => {
    const requete = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest
        .fn()
        .mockResolvedValue([transactions, transactions.length]),
      getMany: jest.fn().mockResolvedValue(transactions),
    };
    const depot = {
      createQueryBuilder: jest.fn().mockReturnValue(requete),
      manager: {
        query: jest
          .fn()
          .mockResolvedValue(avecPreuve.map((reference) => ({ reference }))),
      },
    };
    return {
      requete,
      depot,
      service: new TresorerieService(
        depot as unknown as Repository<Transaction>,
        {} as never,
        {} as never,
      ),
    };
  };

  it('qualifie chaque ligne du journal', async () => {
    const { service: s } = service(
      [ligne('A', 1000), ligne('B', 1000), ligne('C', 0)],
      ['B'],
    );

    const { donnees } = await s.journal({});

    expect(donnees.map((d) => d.canal)).toEqual([
      CanalPaiement.EN_LIGNE,
      CanalPaiement.HORS_LIGNE,
      CanalPaiement.GRATUIT,
    ]);
  });

  it('ne lit pas les preuves quand la page est vide', async () => {
    const { service: s, depot } = service([], []);

    const { donnees } = await s.journal({});

    expect(donnees).toEqual([]);
    expect(depot.manager.query).not.toHaveBeenCalled();
  });

  it('filtre par canal côté base', async () => {
    const { service: s, requete } = service([], []);

    await s.journal({ canal: CanalPaiement.HORS_LIGNE });

    expect(requete.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('justificatifs_paiement') as string,
      { canal: CanalPaiement.HORS_LIGNE },
    );
  });

  it('exporte le canal', async () => {
    const { service: s } = service([ligne('B', 1000)], ['B']);

    const csv = await s.exporterCsv({});

    expect(csv).toContain('Canal');
    expect(csv).toContain(CanalPaiement.HORS_LIGNE);
  });
});
