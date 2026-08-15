import { BilletterieService } from '../billetterie/billetterie.service';
import { CommandeService } from '../commande/commande.service';
import { OrigineTransaction, Transaction } from './entities/transaction.entity';
import { StatutPaiement } from './enums/paiement.enum';
import { RepercussionPaiementService } from './repercussion-paiement.service';
import { TransactionService } from './transaction.service';
import { CotisationService } from '../cotisation/cotisation.service';

/**
 * Aiguillage de l'issue d'un paiement vers le bon domaine.
 *
 * Deux chemins y mènent : la notification du prestataire, et la validation par
 * la trésorerie d'une preuve remise hors ligne. Ces tests verrouillent le fait
 * qu'ils produisent **les mêmes effets** — c'est toute la raison d'avoir
 * factorisé ce service plutôt que d'écrire l'aiguillage deux fois.
 */
describe('RepercussionPaiementService', () => {
  let service: RepercussionPaiementService;
  let trouver: jest.Mock;
  let commande: { confirmerPaiement: jest.Mock; echouerPaiement: jest.Mock };
  let billet: { confirmerPaiement: jest.Mock; echouerPaiement: jest.Mock };
  let enregistrerReglement: jest.Mock;

  const transaction = (origine: OrigineTransaction) =>
    ({ reference: 'REF-1', origine }) as Transaction;

  beforeEach(() => {
    trouver = jest
      .fn()
      .mockResolvedValue(transaction(OrigineTransaction.BOUTIQUE));
    commande = {
      confirmerPaiement: jest.fn().mockResolvedValue(undefined),
      echouerPaiement: jest.fn().mockResolvedValue(undefined),
    };
    billet = {
      confirmerPaiement: jest.fn().mockResolvedValue(undefined),
      echouerPaiement: jest.fn().mockResolvedValue(undefined),
    };
    enregistrerReglement = jest.fn().mockResolvedValue(undefined);

    service = new RepercussionPaiementService(
      { enregistrerReglement } as unknown as CotisationService,
      { trouver } as unknown as TransactionService,
      billet as unknown as BilletterieService,
      commande as unknown as CommandeService,
    );
  });

  it('confirme la commande d’un paiement de boutique', async () => {
    await service.repercuter('REF-1', StatutPaiement.COMPLETE);

    expect(commande.confirmerPaiement).toHaveBeenCalledWith('REF-1');
    // Un paiement de boutique irait sinon chercher un billet qu'il ne
    // trouverait pas, et la commande resterait en attente indéfiniment.
    expect(billet.confirmerPaiement).not.toHaveBeenCalled();
  });

  it('confirme le billet d’un paiement d’événement', async () => {
    trouver.mockResolvedValue(transaction(OrigineTransaction.EVENEMENT));

    await service.repercuter('REF-1', StatutPaiement.COMPLETE);

    expect(billet.confirmerPaiement).toHaveBeenCalledWith('REF-1');
    expect(commande.confirmerPaiement).not.toHaveBeenCalled();
  });

  it('rend le stock sur un echec de boutique', async () => {
    await service.repercuter('REF-1', StatutPaiement.ECHOUE);

    expect(commande.echouerPaiement).toHaveBeenCalled();
    expect(commande.confirmerPaiement).not.toHaveBeenCalled();
  });

  it('libère la place sur un echec d’événement', async () => {
    trouver.mockResolvedValue(transaction(OrigineTransaction.EVENEMENT));

    await service.repercuter('REF-1', StatutPaiement.ECHOUE);

    expect(billet.echouerPaiement).toHaveBeenCalled();
  });

  it('credite le solde d’une cotisation', async () => {
    trouver.mockResolvedValue({
      reference: 'PART-1',
      origine: OrigineTransaction.COTISATION,
      montant: 10_000,
    });

    await service.repercuter('PART-1', StatutPaiement.COMPLETE);

    expect(enregistrerReglement).toHaveBeenCalledWith('PART-1', 10_000);
    expect(commande.confirmerPaiement).not.toHaveBeenCalled();
    expect(billet.confirmerPaiement).not.toHaveBeenCalled();
  });

  it('ne defait rien quand un reglement de cotisation echoue', async () => {
    // Il n'y a ni place a liberer ni stock a rendre : un echec laisse
    // simplement le solde ou il etait, et la personne reessaiera.
    trouver.mockResolvedValue({
      reference: 'PART-1',
      origine: OrigineTransaction.COTISATION,
      montant: 10_000,
    });

    await service.repercuter('PART-1', StatutPaiement.ECHOUE);

    expect(enregistrerReglement).not.toHaveBeenCalled();
    expect(commande.echouerPaiement).not.toHaveBeenCalled();
  });

  it('ne touche à rien sur une transaction inconnue', async () => {
    trouver.mockResolvedValue(null);

    await service.repercuter('REF-INCONNUE', StatutPaiement.COMPLETE);

    expect(commande.confirmerPaiement).not.toHaveBeenCalled();
    expect(billet.confirmerPaiement).not.toHaveBeenCalled();
  });

  it('ignore un statut qui n’est ni abouti ni echoue', async () => {
    // Une transaction encore en attente ne doit declencher aucun effet : ni
    // livrer, ni rendre le stock.
    await service.repercuter('REF-1', StatutPaiement.EN_ATTENTE);

    expect(commande.confirmerPaiement).not.toHaveBeenCalled();
    expect(commande.echouerPaiement).not.toHaveBeenCalled();
  });
});
