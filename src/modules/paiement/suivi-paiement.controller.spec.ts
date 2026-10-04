import { NotFoundException } from '@nestjs/common';
import { OrigineTransaction, Transaction } from './entities/transaction.entity';
import { StatutPaiement } from './enums/paiement.enum';
import { ReconciliationService } from './reconciliation.service';
import { SuiviPaiementController } from './suivi-paiement.controller';
import { TransactionService } from './transaction.service';

/**
 * La page de retour s'y fie pour savoir où renvoyer le payeur : la
 * destination doit être exacte, et le paiement d'autrui invisible.
 */
describe('SuiviPaiementController', () => {
  let controleur: SuiviPaiementController;
  let trouver: jest.Mock;
  let query: jest.Mock;
  let verifierMaintenant: jest.Mock;

  const requete = (id = 'u1') =>
    ({ user: { id } }) as Parameters<SuiviPaiementController['suivre']>[0];

  const transaction = (surcharge: Partial<Transaction> = {}): Transaction =>
    ({
      reference: 'COCFET-1',
      origine: OrigineTransaction.EVENEMENT,
      statut: StatutPaiement.COMPLETE,
      montant: 5_211,
      user: { id: 'u1' },
      ...surcharge,
    }) as Transaction;

  beforeEach(() => {
    trouver = jest.fn().mockResolvedValue(transaction());
    query = jest.fn().mockResolvedValue([{ id: 'i1' }]);
    verifierMaintenant = jest.fn().mockResolvedValue(undefined);

    const transactions = new TransactionService({
      manager: { query },
    } as unknown as ConstructorParameters<typeof TransactionService>[0]);
    transactions.trouver = trouver;

    controleur = new SuiviPaiementController(transactions, {
      verifierMaintenant,
    } as unknown as ReconciliationService);
  });

  it('renvoie au billet payé', async () => {
    const suivi = await controleur.suivre(requete(), 'COCFET-1');

    expect(suivi).toMatchObject({
      statut: StatutPaiement.COMPLETE,
      destination: '/billets/i1/qr',
    });
  });

  it('renvoie à la commande, et aux cotisations', async () => {
    trouver.mockResolvedValue(
      transaction({ reference: 'c-9', origine: OrigineTransaction.BOUTIQUE }),
    );
    expect((await controleur.suivre(requete(), 'c-9')).destination).toBe(
      '/commandes/c-9',
    );

    trouver.mockResolvedValue(
      transaction({ origine: OrigineTransaction.COTISATION }),
    );
    expect((await controleur.suivre(requete(), 'COT-1')).destination).toBe(
      '/mon-espace/cotisations',
    );
  });

  it('vérifie auprès du prestataire avant de répondre', async () => {
    await controleur.suivre(requete(), 'COCFET-1');

    expect(verifierMaintenant).toHaveBeenCalled();
  });

  it('cache le paiement d’autrui', async () => {
    await expect(
      controleur.suivre(requete('intrus'), 'COCFET-1'),
    ).rejects.toThrow(NotFoundException);
    expect(verifierMaintenant).not.toHaveBeenCalled();
  });
});
