import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { ActiviteService } from './activite.service';
import {
  JournalActivite,
  TypeActivite,
} from './entities/journal-activite.entity';

describe('ActiviteService', () => {
  let service: ActiviteService;
  let save: jest.Mock;
  let create: jest.Mock;

  const auteur = { id: 'u-1', firstName: 'Etienne' } as User;

  beforeEach(() => {
    create = jest.fn((donnees: unknown) => donnees);
    save = jest.fn().mockResolvedValue(undefined);

    service = new ActiviteService({
      create,
      save,
    } as unknown as Repository<JournalActivite>);
  });

  it('consigne le fait avec son auteur et son contexte', async () => {
    await service.journaliser({
      type: TypeActivite.PAIEMENT,
      message: 'Un paiement a abouti.',
      auteur,
      metadata: { montant: 5000 },
    });

    expect(create).toHaveBeenCalledWith({
      type: TypeActivite.PAIEMENT,
      message: 'Un paiement a abouti.',
      user: auteur,
      metadata: { montant: 5000 },
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('accepte un fait sans auteur ni contexte', async () => {
    // Ce que la plateforme fait d'elle-même — une expiration, une purge —
    // n'a pas d'auteur. Le journal doit pouvoir le relater quand même.
    await service.journaliser({
      type: TypeActivite.UTILISATEUR,
      message: 'Un compte a été purgé.',
    });

    expect(create).toHaveBeenCalledWith({
      type: TypeActivite.UTILISATEUR,
      message: 'Un compte a été purgé.',
      user: null,
      metadata: null,
    });
  });

  it('ne remonte jamais une erreur d’écriture', async () => {
    // La garantie qui justifie ce service : un journal indisponible ne doit
    // pas devenir la cause d'un paiement non confirmé. L'appelant vient de
    // réussir son action métier, il ne doit pas la voir échouer ici.
    save.mockRejectedValue(new Error('base injoignable'));

    await expect(
      service.journaliser({
        type: TypeActivite.SCAN,
        message: 'Une entrée a été scannée.',
      }),
    ).resolves.toBeUndefined();
  });

  it('survit à une erreur qui n’est pas une Error', async () => {
    // Un pilote de base peut rejeter une chaîne : la mise en forme du
    // message ne doit pas lever à son tour.
    save.mockRejectedValue('panne');

    await expect(
      service.journaliser({
        type: TypeActivite.COMMANDE,
        message: 'Une commande a été payée.',
      }),
    ).resolves.toBeUndefined();
  });
});
