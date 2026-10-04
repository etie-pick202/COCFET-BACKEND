import { ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CotisationService } from '../cotisation/cotisation.service';
import { NettoyageFichiers } from '../file/nettoyage-fichiers.service';
import { OrigineTransaction } from '../paiement/entities/transaction.entity';
import { StatutPaiement } from '../paiement/enums/paiement.enum';
import { RepercussionPaiementService } from '../paiement/repercussion-paiement.service';
import { TransactionService } from '../paiement/transaction.service';
import {
  JustificatifPaiement,
  StatutJustificatif,
} from './entities/justificatif-paiement.entity';
import { JustificatifService } from './justificatif.service';

/**
 * Le rattachement d'une preuve à une échéance de cotisation, et ce que la
 * décision de la trésorerie produit.
 */
describe('JustificatifService', () => {
  let service: JustificatifService;
  let justificatifs: Record<string, jest.Mock>;
  let transactions: Record<string, jest.Mock>;
  let repercuter: jest.Mock;
  let cotisations: Record<string, jest.Mock>;

  const enAttente = (surcharge: Partial<JustificatifPaiement> = {}) => ({
    id: 'j1',
    reference: 'COT-1',
    origine: OrigineTransaction.COTISATION,
    statut: StatutJustificatif.EN_ATTENTE,
    ...surcharge,
  });

  beforeEach(() => {
    justificatifs = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest
        .fn()
        .mockImplementation((j: object) => Promise.resolve({ ...j, id: 'j1' })),
      create: jest.fn().mockImplementation((j: unknown) => j),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    transactions = {
      trouver: jest.fn().mockResolvedValue({
        reference: 'COT-1',
        origine: OrigineTransaction.COTISATION,
        statut: StatutPaiement.EN_ATTENTE,
        user: { id: 'u1' },
      }),
      certifier: jest.fn().mockResolvedValue(undefined),
      appliquer: jest.fn().mockResolvedValue(true),
    };
    repercuter = jest.fn().mockResolvedValue(undefined);
    cotisations = {
      preparerJustificatif: jest.fn().mockResolvedValue({
        reference: 'COT-1',
        libelle: 'Cotisation 2027 — Tranche 1',
      }),
      annulerPreparation: jest.fn().mockResolvedValue(undefined),
    };

    service = new JustificatifService(
      justificatifs as unknown as Repository<JustificatifPaiement>,
      transactions as unknown as TransactionService,
      { repercuter } as unknown as RepercussionPaiementService,
      {} as NettoyageFichiers,
      cotisations as unknown as CotisationService,
    );
  });

  describe('dépôt pour une cotisation', () => {
    const deposer = () =>
      service.soumettre(
        { id: 'u1' },
        {
          participationId: 'p1',
          ordreTranche: 1,
          cle: 'justificatifs/a.png',
          montantDeclare: 10_000,
        },
      );

    it('rattache la pièce à l’échéance choisie, sans référence à fournir', async () => {
      await deposer();

      expect(cotisations.preparerJustificatif).toHaveBeenCalledWith(
        { id: 'u1' },
        'p1',
        1,
      );
      expect(justificatifs.save).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: 'COT-1',
          libelle: 'Cotisation 2027 — Tranche 1',
        }),
      );
    });

    it('défait le règlement préparé si la pièce ne peut être déposée', async () => {
      justificatifs.findOne.mockResolvedValue(enAttente());

      await expect(deposer()).rejects.toThrow(ConflictException);
      expect(cotisations.annulerPreparation).toHaveBeenCalledWith('COT-1');
    });
  });

  it('dépose encore par référence, pour un billet ou une commande', async () => {
    await service.soumettre(
      { id: 'u1' },
      { reference: 'COT-1', cle: 'justificatifs/a.png', montantDeclare: 500 },
    );

    expect(cotisations.preparerJustificatif).not.toHaveBeenCalled();
    expect(justificatifs.save).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'COT-1', libelle: null }),
    );
  });

  it('certifie le montant reçu, sans frais, avant de répercuter', async () => {
    justificatifs.findOne.mockResolvedValue(enAttente());

    await service.valider('j1', { id: 'v1' }, { montantRecu: 9_000 });

    expect(transactions.certifier).toHaveBeenCalledWith('COT-1', 9_000);
    expect(transactions.certifier.mock.invocationCallOrder[0]).toBeLessThan(
      transactions.appliquer.mock.invocationCallOrder[0],
    );
    expect(repercuter).toHaveBeenCalledWith('COT-1', StatutPaiement.COMPLETE);
  });

  it('libère l’échéance d’une cotisation au refus, motif transmis', async () => {
    justificatifs.findOne.mockResolvedValue(enAttente());

    await service.refuser('j1', { id: 'v1' }, 'Capture illisible');

    expect(transactions.appliquer).toHaveBeenCalledWith(
      'COT-1',
      StatutPaiement.ECHOUE,
    );
    expect(repercuter).toHaveBeenCalledWith(
      'COT-1',
      StatutPaiement.ECHOUE,
      'Capture illisible',
    );
  });

  it('laisse en attente le règlement d’un billet refusé', async () => {
    // Un billet garde sa place : la personne peut déposer une autre pièce.
    justificatifs.findOne.mockResolvedValue(
      enAttente({ origine: OrigineTransaction.EVENEMENT }),
    );

    await service.refuser('j1', { id: 'v1' }, 'Capture illisible');

    expect(transactions.appliquer).not.toHaveBeenCalled();
    expect(repercuter).not.toHaveBeenCalled();
  });
});
