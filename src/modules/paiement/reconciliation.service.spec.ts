import { ConfigService } from '@nestjs/config';
import { OrigineTransaction, Transaction } from './entities/transaction.entity';
import { MethodePaiement, StatutPaiement } from './enums/paiement.enum';
import { PasserellePaiement } from './ports/passerelle-paiement';
import { ReconciliationService } from './reconciliation.service';
import { RepercussionPaiementService } from './repercussion-paiement.service';
import { TransactionService } from './transaction.service';

const GRACE = 3;
const EXPIRATION = 30;

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let enAttente: Transaction[];
  let appliquer: jest.Mock;
  let verifier: jest.Mock;
  let repercuter: jest.Mock;

  /** Effets demandés à l'aiguillage, par issue. */
  const confirmes = () =>
    (repercuter.mock.calls as unknown[][]).filter(
      (c) => c[1] === StatutPaiement.COMPLETE,
    );
  const echoues = () =>
    (repercuter.mock.calls as unknown[][]).filter(
      (c) => c[1] === StatutPaiement.ECHOUE,
    );

  /** Transaction en attente, ouverte il y a `minutes`. */
  const transaction = (
    minutes: number,
    surcharge: Partial<Transaction> = {},
  ): Transaction =>
    ({
      reference: 'COCFET-0001',
      referenceExterne: 'trx_1',
      origine: OrigineTransaction.EVENEMENT,
      methodePaiement: MethodePaiement.MTN_MOMO,
      statut: StatutPaiement.EN_ATTENTE,
      createdAt: new Date(Date.now() - minutes * 60_000),
      ...surcharge,
    }) as Transaction;

  const repondre = (statut: StatutPaiement) =>
    verifier.mockResolvedValue({ statut });

  beforeEach(() => {
    enAttente = [];
    // Par défaut la transition est neuve : c'est le cas courant.
    appliquer = jest.fn().mockResolvedValue(true);
    verifier = jest.fn();
    repercuter = jest.fn().mockResolvedValue(undefined);

    service = new ReconciliationService(
      {
        enAttenteAvant: jest.fn(() => Promise.resolve(enAttente)),
        appliquer,
      } as unknown as TransactionService,
      { verifier } as unknown as PasserellePaiement,
      { repercuter } as unknown as RepercussionPaiementService,
      {
        get: (cle: string) =>
          cle === 'PAIEMENT_DELAI_GRACE_MINUTES' ? GRACE : EXPIRATION,
      } as unknown as ConfigService,
    );
  });

  it('confirme un paiement que le prestataire donne pour abouti', async () => {
    // Le cas qui justifie tout : le webhook s'est perdu, l'argent est débité,
    // et sans cette tâche le billet resterait en attente pour toujours.
    enAttente = [transaction(10)];
    repondre(StatutPaiement.COMPLETE);

    await service.reconcilier();

    expect(verifier).toHaveBeenCalledWith('trx_1');
    expect(appliquer).toHaveBeenCalledWith(
      'COCFET-0001',
      StatutPaiement.COMPLETE,
    );
    expect(repercuter).toHaveBeenCalledWith(
      'COCFET-0001',
      StatutPaiement.COMPLETE,
    );
    expect(echoues()).toHaveLength(0);
  });

  it('rend la place quand le prestataire annonce un refus', async () => {
    enAttente = [transaction(10)];
    repondre(StatutPaiement.ECHOUE);

    await service.reconcilier();

    expect(repercuter).toHaveBeenCalledWith(
      'COCFET-0001',
      StatutPaiement.ECHOUE,
      expect.stringContaining('refusé'),
    );
    expect(confirmes()).toHaveLength(0);
  });

  it('patiente tant que le délai d’abandon n’est pas dépassé', async () => {
    // Toujours en attente chez le prestataire, mais récente : quelqu'un est
    // peut-être en train de valider sur son téléphone.
    enAttente = [transaction(10)];
    repondre(StatutPaiement.EN_ATTENTE);

    await service.reconcilier();

    expect(appliquer).not.toHaveBeenCalled();
    expect(repercuter).not.toHaveBeenCalled();
  });

  it('abandonne au-delà du délai, et libère la place', async () => {
    enAttente = [transaction(EXPIRATION + 1)];
    repondre(StatutPaiement.EN_ATTENTE);

    await service.reconcilier();

    expect(appliquer).toHaveBeenCalledWith(
      'COCFET-0001',
      StatutPaiement.ECHOUE,
    );
    expect(repercuter).toHaveBeenCalledWith(
      'COCFET-0001',
      StatutPaiement.ECHOUE,
      expect.stringContaining(`${EXPIRATION} minutes`),
    );
  });

  it('ne conclut rien quand le prestataire est injoignable', async () => {
    // Le point de sûreté : déclarer l'échec hors ligne rendrait une place
    // peut-être déjà payée, et annulerait un billet valide.
    enAttente = [transaction(EXPIRATION + 1)];
    verifier.mockRejectedValue(new Error('réseau'));

    await service.reconcilier();

    expect(appliquer).not.toHaveBeenCalled();
    expect(repercuter).not.toHaveBeenCalled();
  });

  it('n’interroge pas le prestataire sans référence externe', async () => {
    enAttente = [transaction(EXPIRATION + 1, { referenceExterne: null })];

    await service.reconcilier();

    expect(verifier).not.toHaveBeenCalled();
    expect(repercuter).not.toHaveBeenCalled();
  });

  it('laisse en paix un règlement hors ligne en attente de la trésorerie', async () => {
    // Un justificatif de cotisation ouvre une transaction sans opérateur : le
    // prestataire n'en sait rien, la signaler toutes les cinq minutes serait
    // du bruit.
    enAttente = [
      transaction(EXPIRATION + 1, {
        referenceExterne: null,
        methodePaiement: null,
        origine: OrigineTransaction.COTISATION,
      }),
    ];

    await service.reconcilier();

    expect(verifier).not.toHaveBeenCalled();
    expect(appliquer).not.toHaveBeenCalled();
  });

  it('confie une cotisation à l’aiguillage, pas à la billetterie', async () => {
    enAttente = [
      transaction(10, {
        reference: 'COT-1',
        origine: OrigineTransaction.COTISATION,
      }),
    ];
    repondre(StatutPaiement.COMPLETE);

    await service.reconcilier();

    expect(repercuter).toHaveBeenCalledWith('COT-1', StatutPaiement.COMPLETE);
  });

  describe('vérification à la demande', () => {
    it('vérifie un paiement en attente passé le délai', async () => {
      repondre(StatutPaiement.COMPLETE);

      await service.verifierMaintenant(transaction(1));

      expect(verifier).toHaveBeenCalledWith('trx_1');
    });

    it('laisse le webhook arriver sur un paiement tout récent', async () => {
      await service.verifierMaintenant(transaction(0));

      expect(verifier).not.toHaveBeenCalled();
    });

    it('ignore un paiement déjà tranché', async () => {
      await service.verifierMaintenant(
        transaction(5, { statut: StatutPaiement.COMPLETE }),
      );

      expect(verifier).not.toHaveBeenCalled();
    });
  });

  it('ne rejoue pas l’effet de bord quand un webhook a devancé', async () => {
    // `appliquer` rend false : la transition avait déjà eu lieu. Confirmer de
    // nouveau enverrait un second billet, échouer libérerait deux places.
    enAttente = [transaction(10)];
    repondre(StatutPaiement.COMPLETE);
    appliquer.mockResolvedValue(false);

    await service.reconcilier();

    expect(repercuter).not.toHaveBeenCalled();
  });

  it('poursuit malgré une transaction en erreur', async () => {
    // Un prestataire injoignable sur la première ne doit pas priver les
    // suivantes de leur rattrapage.
    enAttente = [
      transaction(10, { reference: 'A', referenceExterne: 'trx_a' }),
      transaction(10, { reference: 'B', referenceExterne: 'trx_b' }),
    ];
    verifier
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValueOnce({ statut: StatutPaiement.COMPLETE });

    await service.reconcilier();

    expect(confirmes()).toHaveLength(1);
    expect(repercuter).toHaveBeenCalledWith('B', StatutPaiement.COMPLETE);
  });

  it('ne fait rien quand aucun paiement n’attend', async () => {
    await service.reconcilier();

    expect(verifier).not.toHaveBeenCalled();
  });
});
