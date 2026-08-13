import { Repository } from 'typeorm';
import { StatutPaiement } from './enums/paiement.enum';
import { Transaction } from './entities/transaction.entity';
import { TransactionService } from './transaction.service';

/**
 * Refermer une transaction que le prestataire n'a jamais acceptée.
 *
 * La transaction est ouverte **avant** l'appel au prestataire, pour qu'un
 * webhook arrivant pendant cet appel trouve une ligne à mettre à jour. Quand
 * cet appel échoue, la ligne restait `EN_ATTENTE` sans référence prestataire :
 * la réconciliation la signalait toutes les cinq minutes sans jamais pouvoir
 * la clore, et son montant pesait au journal de trésorerie.
 *
 * Ce qui se joue ici est la **condition** de fermeture. Trop large, elle
 * déclarerait échoué un paiement en cours de validation sur le téléphone du
 * client — un règlement bien réel, perdu.
 */
describe('TransactionService — abandon', () => {
  let service: TransactionService;
  let execute: jest.Mock;
  let where: jest.Mock;
  let set: jest.Mock;

  beforeEach(() => {
    execute = jest.fn().mockResolvedValue({ affected: 1 });
    where = jest.fn().mockReturnValue({ execute });
    set = jest.fn().mockReturnValue({ where });

    const constructeur = {
      update: jest.fn().mockReturnValue({ set }),
    };

    service = new TransactionService({
      createQueryBuilder: jest.fn().mockReturnValue(constructeur),
    } as unknown as Repository<Transaction>);
  });

  it('marque la transaction échouée plutôt que de la supprimer', async () => {
    // Une tentative a eu lieu : la trace vaut mieux que l'oubli.
    await service.abandonner('COCFET-0001');

    expect(set).toHaveBeenCalledWith({ statut: StatutPaiement.ECHOUE });
  });

  it('n’agit que sur une transaction encore en attente', async () => {
    await service.abandonner('COCFET-0001');

    const [condition, parametres] = where.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];

    expect(condition).toContain('statut = :attente');
    expect(parametres).toMatchObject({
      reference: 'COCFET-0001',
      attente: StatutPaiement.EN_ATTENTE,
    });
  });

  it('épargne une transaction que le prestataire a acceptée', async () => {
    // Si un identifiant prestataire existe, le paiement est peut-être en
    // cours de validation sur le téléphone du client. Le déclarer échoué
    // ferait perdre un règlement réel — c'est le défaut à ne pas commettre.
    await service.abandonner('COCFET-0001');

    const [condition] = where.mock.calls[0] as [string];

    expect(condition).toContain('reference_externe IS NULL');
  });

  it('rend vrai quand une ligne a été refermée', async () => {
    await expect(service.abandonner('COCFET-0001')).resolves.toBe(true);
  });

  it('rend faux quand rien ne correspond', async () => {
    // Cas d'une transaction déjà acceptée, déjà close, ou jamais ouverte :
    // l'appelant doit pouvoir invoquer l'abandon sans rien vérifier d'abord.
    execute.mockResolvedValue({ affected: 0 });

    await expect(service.abandonner('COCFET-0001')).resolves.toBe(false);
  });
});
