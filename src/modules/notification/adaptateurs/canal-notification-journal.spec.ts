import { Logger } from '@nestjs/common';
import { TypeNotification } from '../entities/notification.entity';
import { MessagePush } from '../ports/canal-notification';
import { CanalNotificationJournal } from './canal-notification-journal';

describe('CanalNotificationJournal', () => {
  let canal: CanalNotificationJournal;

  const message = (surcharge: Partial<MessagePush> = {}): MessagePush => ({
    destinataireId: 'utilisateur-1',
    type: TypeNotification.EVENEMENT,
    titre: 'Gala des finissants',
    corps: 'Les inscriptions sont ouvertes.',
    ...surcharge,
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    canal = new CanalNotificationJournal();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('conserve les messages dans l’ordre d’envoi', async () => {
    await canal.diffuser(message({ titre: 'Premier' }));
    await canal.diffuser(message({ titre: 'Second' }));

    expect(canal.historique().map((m) => m.titre)).toEqual([
      'Premier',
      'Second',
    ]);
  });

  it('filtre l’historique par destinataire', async () => {
    await canal.diffuser(message({ destinataireId: 'a' }));
    await canal.diffuser(message({ destinataireId: 'b' }));

    expect(canal.historique('a')).toHaveLength(1);
    expect(canal.historique('a')[0].destinataireId).toBe('a');
  });

  it('ne laisse pas l’historique croître sans fin', async () => {
    // Ce canal vit aussi longtemps que le processus : sans plafond, une file
    // qui s'emballe finirait par consommer toute la mémoire du serveur.
    for (let i = 0; i < 250; i++) {
      await canal.diffuser(message({ titre: `message-${i}` }));
    }

    const historique = canal.historique();
    expect(historique).toHaveLength(200);
    // Ce sont les plus anciens qui sont écartés.
    expect(historique[0].titre).toBe('message-50');
    expect(historique[199].titre).toBe('message-249');
  });

  it('ne lève jamais, pour ne pas faire échouer l’action métier', async () => {
    // Une commande payée reste payée même si le destinataire est injoignable.
    await expect(canal.diffuser(message())).resolves.toBeUndefined();
  });

  it('remet le compteur à zéro entre deux tests', async () => {
    await canal.diffuser(message());
    canal.vider();

    expect(canal.historique()).toHaveLength(0);
  });

  it('rend une copie, non la liste interne', async () => {
    await canal.diffuser(message());
    canal.historique().push(message({ titre: 'injecté' }));

    expect(canal.historique()).toHaveLength(1);
  });
});
