import { BadRequestException, ConflictException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { ActiviteService } from '../activite/activite.service';
import type { PasserellePaiement } from '../paiement/ports/passerelle-paiement';
import { CotisationService } from '../cotisation/cotisation.service';
import { TypeDocument } from '../document/entities/document.entity';
import { DocumentService } from '../document/document.service';
import { NotificationService } from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import { AlerteTresorerieService } from '../notification/alerte-tresorerie.service';
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
  let alertes: Record<string, jest.Mock>;
  let annuler: jest.Mock;
  let retirerFacture: jest.Mock;
  let notifier: jest.Mock;
  let journaliser: jest.Mock;
  let verifier: jest.Mock;

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
      rouvrir: jest.fn().mockResolvedValue(true),
    };
    repercuter = jest.fn().mockResolvedValue(undefined);
    annuler = jest.fn().mockResolvedValue({
      type: TypeDocument.FACTURE_COTISATION,
      source: 'r1',
    });
    retirerFacture = jest.fn().mockResolvedValue('FAC-2027-0007');
    notifier = jest.fn().mockResolvedValue(null);
    journaliser = jest.fn().mockResolvedValue(undefined);
    verifier = jest
      .fn()
      .mockResolvedValue({ statut: StatutPaiement.EN_ATTENTE });
    alertes = {
      preuveADecider: jest.fn().mockResolvedValue(undefined),
      validationAnnulee: jest.fn().mockResolvedValue(undefined),
    };
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
      { repercuter, annuler } as unknown as RepercussionPaiementService,
      {} as NettoyageFichiers,
      cotisations as unknown as CotisationService,
      alertes as unknown as AlerteTresorerieService,
      { notifier } as unknown as NotificationService,
      { retirerFacture } as unknown as DocumentService,
      { journaliser } as unknown as ActiviteService,
      {
        findOneBy: jest
          .fn()
          .mockResolvedValue({ firstName: 'Awa', lastName: 'Ngassa' }),
      } as unknown as Repository<User>,
      { verifier } as unknown as PasserellePaiement,
    );
  });

  describe('annulation d’une validation', () => {
    const validee = (surcharge: Partial<JustificatifPaiement> = {}) => ({
      id: 'j1',
      reference: 'COT-1',
      origine: OrigineTransaction.COTISATION,
      libelle: 'Cotisation 2027 — Tranche 1',
      statut: StatutJustificatif.VALIDE,
      montantDeclare: 10_000,
      montantRecu: 9_000,
      annulations: 0,
      user: { id: 'u1', firstName: 'Paul', lastName: 'Biya' },
      validateur: { id: 'v1' },
      ...surcharge,
    });
    const MOTIF = 'Mauvaise pièce validée par erreur.';

    it('défait les effets, rouvre le paiement et remet la preuve en attente', async () => {
      justificatifs.findOne.mockResolvedValue(validee());

      await service.annulerValidation('j1', { id: 't1' }, MOTIF);

      expect(annuler).toHaveBeenCalledWith('COT-1', 10_000);
      expect(transactions.rouvrir).toHaveBeenCalledWith('COT-1', 10_000);
      expect(justificatifs.update).toHaveBeenCalledWith(
        'j1',
        expect.objectContaining({
          statut: StatutJustificatif.EN_ATTENTE,
          validateur: null,
          decideLe: null,
          montantRecu: null,
          recuPar: null,
          motifAnnulation: MOTIF,
          validationAnnuleePar: { id: 't1' },
          annulations: 1,
        }),
      );
    });

    it('retire la facture émise', async () => {
      justificatifs.findOne.mockResolvedValue(validee());

      await service.annulerValidation('j1', { id: 't1' }, MOTIF);

      expect(retirerFacture).toHaveBeenCalledWith(
        TypeDocument.FACTURE_COTISATION,
        'r1',
      );
    });

    it('garde la mémoire : journal, payeur prévenu, trésorerie alertée', async () => {
      justificatifs.findOne.mockResolvedValue(validee());

      await service.annulerValidation('j1', { id: 't1' }, MOTIF);

      expect(journaliser).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining(MOTIF) as unknown,
          metadata: expect.objectContaining({
            validateurInitial: 'v1',
            factureRetiree: 'FAC-2027-0007',
          }) as unknown,
        }),
      );
      expect(notifier).toHaveBeenCalledWith(
        expect.objectContaining({
          titre: 'Votre preuve de paiement est de nouveau examinée',
        }),
      );
      expect(alertes.validationAnnulee).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        9_000,
        'Awa Ngassa',
        MOTIF,
        't1',
      );
    });

    it.each([StatutJustificatif.EN_ATTENTE, StatutJustificatif.REFUSE])(
      'refuse une preuve %s : il n’y a rien à défaire',
      async (statut) => {
        justificatifs.findOne.mockResolvedValue(validee({ statut }));

        await expect(
          service.annulerValidation('j1', { id: 't1' }, MOTIF),
        ).rejects.toThrow(BadRequestException);
        expect(annuler).not.toHaveBeenCalled();
      },
    );

    it('ne touche à rien quand un domaine refuse (billet scanné…)', async () => {
      justificatifs.findOne.mockResolvedValue(validee());
      annuler.mockRejectedValue(new ConflictException('Billet déjà scanné.'));

      await expect(
        service.annulerValidation('j1', { id: 't1' }, MOTIF),
      ).rejects.toThrow(ConflictException);

      expect(transactions.rouvrir).not.toHaveBeenCalled();
      expect(justificatifs.update).not.toHaveBeenCalled();
      expect(retirerFacture).not.toHaveBeenCalled();
    });

    it('n’échoue pas si les traces ne peuvent pas être écrites', async () => {
      justificatifs.findOne.mockResolvedValue(validee());
      journaliser.mockRejectedValue(new Error('journal indisponible'));

      await expect(
        service.annulerValidation('j1', { id: 't1' }, MOTIF),
      ).resolves.toBeDefined();
      expect(justificatifs.update).toHaveBeenCalled();
    });

    describe('paiement lancé en ligne', () => {
      beforeEach(() => {
        transactions.trouver.mockResolvedValue({
          reference: 'COT-1',
          origine: OrigineTransaction.COTISATION,
          referenceExterne: 'fapshi-1',
          user: { id: 'u1' },
        });
        justificatifs.findOne.mockResolvedValue(validee());
      });

      it('défait quand Fapshi n’a rien encaissé', async () => {
        await service.annulerValidation('j1', { id: 't1' }, MOTIF);

        expect(verifier).toHaveBeenCalledWith('fapshi-1');
        expect(annuler).toHaveBeenCalled();
      });

      it('refuse quand Fapshi atteste le paiement : l’argent est arrivé', async () => {
        verifier.mockResolvedValue({ statut: StatutPaiement.COMPLETE });

        await expect(
          service.annulerValidation('j1', { id: 't1' }, MOTIF),
        ).rejects.toThrow('aussi confirmé par Fapshi');
        expect(annuler).not.toHaveBeenCalled();
      });

      it('s’abstient quand Fapshi ne répond pas', async () => {
        verifier.mockRejectedValue(new Error('réseau'));

        await expect(
          service.annulerValidation('j1', { id: 't1' }, MOTIF),
        ).rejects.toThrow('Fapshi ne répond pas');
        expect(annuler).not.toHaveBeenCalled();
        expect(justificatifs.update).not.toHaveBeenCalled();
      });
    });

    it('sérialise deux annulations simultanées de la même preuve', async () => {
      let statut = StatutJustificatif.VALIDE;
      justificatifs.findOne.mockImplementation(() =>
        Promise.resolve(validee({ statut })),
      );
      justificatifs.update.mockImplementation(() => {
        statut = StatutJustificatif.EN_ATTENTE;
        return Promise.resolve({ affected: 1 });
      });

      const resultats = await Promise.allSettled([
        service.annulerValidation('j1', { id: 't1' }, MOTIF),
        service.annulerValidation('j1', { id: 't2' }, MOTIF),
      ]);

      expect(
        resultats.map((r) => r.status).sort((a, b) => a.localeCompare(b)),
      ).toEqual(['fulfilled', 'rejected']);
      expect(annuler).toHaveBeenCalledTimes(1);
    });
  });

  describe('dépôt pour une cotisation', () => {
    const deposer = () =>
      service.soumettre(
        { id: 'u1' },
        {
          participationId: 'p1',
          ordreTranche: 1,
          cle: 'justificatifs/u1_a.png',
          montantDeclare: 10_000,
        },
      );

    it('rattache la pièce à l’échéance choisie, sans référence à fournir', async () => {
      await deposer();

      expect(cotisations.preparerJustificatif).toHaveBeenCalledWith(
        { id: 'u1' },
        'p1',
        1,
        // Le montant déclaré suit : c'est lui qui est contrôlé contre ce qu'il
        // reste sur l'échéance.
        10_000,
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
      {
        reference: 'COT-1',
        cle: 'justificatifs/u1_a.png',
        montantDeclare: 500,
      },
    );

    expect(cotisations.preparerJustificatif).not.toHaveBeenCalled();
    expect(justificatifs.save).toHaveBeenCalledWith(
      expect.objectContaining({ reference: 'COT-1', libelle: null }),
    );
  });

  it('refuse la pièce déposée par quelqu’un d’autre', async () => {
    await expect(
      service.soumettre(
        { id: 'u1' },
        {
          reference: 'COT-1',
          cle: 'justificatifs/u2_capture.png',
          montantDeclare: 500,
        },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(justificatifs.save).not.toHaveBeenCalled();
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
