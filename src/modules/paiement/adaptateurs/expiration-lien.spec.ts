import { ConfigService } from '@nestjs/config';
import { PasserelleFapshi } from './passerelle-fapshi';

/**
 * Invalidation d'une page de paiement restée ouverte.
 *
 * Appelée quand la commande ou l'inscription est annulée avant son règlement.
 * Sans cela le lien reste vivant chez Fapshi : quelqu'un peut encore payer
 * alors que le stock ou la place ont déjà été rendus.
 *
 * **Ce n'est pas la garantie d'intégrité**, seulement une politesse qui évite
 * d'avoir à rembourser. La garantie tient au refus de confirmer un ordre
 * annulé, qui ne dépend d'aucun appel réseau — d'où l'exigence, vérifiée ici,
 * que cet appel ne lève jamais.
 */
describe('PasserelleFapshi — expiration du lien de paiement', () => {
  let appels: { url: string; corps: unknown }[];
  let reponse: () => Promise<Response>;
  let passerelle: PasserelleFapshi;

  const config = {
    get: (cle: string, defaut?: string) =>
      ({ FAPSHI_BASE_URL: 'https://live.fapshi.test' })[cle] ?? defaut,
    getOrThrow: () => 'secret',
  } as unknown as ConfigService;

  beforeEach(() => {
    appels = [];
    reponse = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: 'expired' }),
        text: () => Promise.resolve('{}'),
      } as Response);

    global.fetch = jest.fn((url: string, options?: { body?: string }) => {
      appels.push({
        url,
        corps: options?.body ? JSON.parse(options.body) : undefined,
      });
      return reponse();
    }) as unknown as typeof fetch;

    passerelle = new PasserelleFapshi(config);
  });

  it('demande l’expiration au prestataire', async () => {
    await passerelle.expirer('trans_42');

    expect(appels).toEqual([
      {
        url: 'https://live.fapshi.test/expire-pay',
        corps: { transId: 'trans_42' },
      },
    ]);
  });

  it('ne lève pas quand le prestataire refuse', async () => {
    // L'annulation a bien eu lieu : la refuser parce que Fapshi n'a pas
    // répondu serait pire que le lien resté ouvert, dont un ordre annulé ne
    // peut de toute façon plus rien faire.
    reponse = () =>
      Promise.resolve({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'unknown transaction' }),
        text: () => Promise.resolve('{}'),
      } as Response);

    await expect(passerelle.expirer('trans_42')).resolves.toBeUndefined();
  });

  it('ne lève pas quand le réseau a coupé', async () => {
    reponse = () => Promise.reject(new Error('réseau coupé'));

    await expect(passerelle.expirer('trans_42')).resolves.toBeUndefined();
  });
});
