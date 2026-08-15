import { Repository } from 'typeorm';
import { TypeNotification } from './entities/notification.entity';
import { PreferenceNotification } from './entities/preference-notification.entity';
import { PreferenceEmailService } from './preference-email.service';

/**
 * Le point d'interrogation des réglages, pour les envois hors du circuit des
 * notifications.
 *
 * Le comportement qui compte est le **défaut** : l'absence de réglage vaut
 * « activé ». L'inverse obligerait chacun à réclamer ce qu'il attend, et un
 * nouvel arrivant ne recevrait rien.
 */
describe('PreferenceEmailService', () => {
  let service: PreferenceEmailService;
  let findOne: jest.Mock;

  beforeEach(() => {
    findOne = jest.fn().mockResolvedValue(null);
    service = new PreferenceEmailService({
      findOne,
    } as unknown as Repository<PreferenceNotification>);
  });

  it('autorise en l’absence de réglage', async () => {
    await expect(
      service.autorise('u1', TypeNotification.SYSTEME),
    ).resolves.toBe(true);
  });

  it('autorise quand le canal est explicitement activé', async () => {
    findOne.mockResolvedValue({ canalEmail: true });

    await expect(
      service.autorise('u1', TypeNotification.SYSTEME),
    ).resolves.toBe(true);
  });

  it('refuse quand la personne a coupé ce canal', async () => {
    findOne.mockResolvedValue({ canalEmail: false });

    await expect(
      service.autorise('u1', TypeNotification.SYSTEME),
    ).resolves.toBe(false);
  });

  it('interroge le réglage de la personne et du type demandés', async () => {
    // Le réglage est par couple : couper les rappels ne doit pas couper les
    // paiements.
    await service.autorise('u1', TypeNotification.PAIEMENT);

    expect(findOne).toHaveBeenCalledWith({
      where: { user: { id: 'u1' }, type: TypeNotification.PAIEMENT },
    });
  });
});
