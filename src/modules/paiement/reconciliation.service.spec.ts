import { ConfigService } from '@nestjs/config';
import { BilletterieService } from '../billetterie/billetterie.service';
import { CommandeService } from '../commande/commande.service';
import { OrigineTransaction, Transaction } from './entities/transaction.entity';
import { StatutPaiement } from './enums/paiement.enum';
import { PasserellePaiement } from './ports/passerelle-paiement';
import { ReconciliationService } from './reconciliation.service';
import { TransactionService } from './transaction.service';

const GRACE = 3;
const EXPIRATION = 30;

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let enAttente: Transaction[];
  let appliquer: jest.Mock;
  let verifier: jest.Mock;
  let confirmerPaiement: jest.Mock;
  let echouerPaiement: jest.Mock;

  /** Transaction en attente, ouverte il y a `minutes`. */
  const transaction = (
    minutes: number,
    surcharge: Partial<Transaction> = {},
  ): Transaction =>
    ({
      reference: 'COCFET-0001',
      referenceExterne: 'trx_1',
      origine: OrigineTransaction.EVENEMENT,
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
    confirmerPaiement = jest.fn().mockResolvedValue(undefined);
    echouerPaiement = jest.fn().mockResolvedValue(undefined);

    service = new ReconciliationService(
      {
        enAttenteAvant: jest.fn(() => Promise.resolve(enAttente)),
        appliquer,
      } as unknown as TransactionService,
      { verifier } as unknown as PasserellePaiement,
      {
        confirmerPaiement,
        echouerPaiement,
      } as unknown as BilletterieService,
      // Les transactions de ces cas portent l'origine EVENEMENT : le double de
      // la boutique n'est là que pour satisfaire l'injection.
      {
        confirmerPaiement: jest.fn(),
        echouerPaiement: jest.fn(),
      } as unknown as CommandeService,
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
    expect(confirmerPaiement).toHaveBeenCalledWith('COCFET-0001');
    expect(echouerPaiement).not.toHaveBeenCalled();
  });

  it('rend la place quand le prestataire annonce un refus', async () => {
    enAttente = [transaction(10)];
    repondre(StatutPaiement.ECHOUE);

    await service.reconcilier();

    expect(echouerPaiement).toHaveBeenCalledWith(
      'COCFET-0001',
      expect.stringContaining('refusé'),
    );
    expect(confirmerPaiement).not.toHaveBeenCalled();
  });

  it('patiente tant que le délai d’abandon n’est pas dépassé', async () => {
    // Toujours en attente chez le prestataire, mais récente : quelqu'un est
    // peut-être en train de valider sur son téléphone.
    enAttente = [transaction(10)];
    repondre(StatutPaiement.EN_ATTENTE);

    await service.reconcilier();

    expect(appliquer).not.toHaveBeenCalled();
    expect(echouerPaiement).not.toHaveBeenCalled();
  });

  it('abandonne au-delà du délai, et libère la place', async () => {
    enAttente = [transaction(EXPIRATION + 1)];
    repondre(StatutPaiement.EN_ATTENTE);

    await service.reconcilier();

    expect(appliquer).toHaveBeenCalledWith(
      'COCFET-0001',
      StatutPaiement.ECHOUE,
    );
    expect(echouerPaiement).toHaveBeenCalledWith(
      'COCFET-0001',
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
    expect(echouerPaiement).not.toHaveBeenCalled();
    expect(confirmerPaiement).not.toHaveBeenCalled();
  });

  it('n’interroge pas le prestataire sans référence externe', async () => {
    enAttente = [transaction(EXPIRATION + 1, { referenceExterne: null })];

    await service.reconcilier();

    expect(verifier).not.toHaveBeenCalled();
    expect(echouerPaiement).not.toHaveBeenCalled();
  });

  it('ne rejoue pas l’effet de bord quand un webhook a devancé', async () => {
    // `appliquer` rend false : la transition avait déjà eu lieu. Confirmer de
    // nouveau enverrait un second billet, échouer libérerait deux places.
    enAttente = [transaction(10)];
    repondre(StatutPaiement.COMPLETE);
    appliquer.mockResolvedValue(false);

    await service.reconcilier();

    expect(confirmerPaiement).not.toHaveBeenCalled();
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

    expect(confirmerPaiement).toHaveBeenCalledTimes(1);
    expect(confirmerPaiement).toHaveBeenCalledWith('B');
  });

  it('ne fait rien quand aucun paiement n’attend', async () => {
    await service.reconcilier();

    expect(verifier).not.toHaveBeenCalled();
  });
});
