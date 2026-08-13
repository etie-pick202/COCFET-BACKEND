import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MethodePaiement, StatutPaiement } from '../enums/paiement.enum';
import { DemandePaiement } from '../ports/passerelle-paiement';
import { PasserelleFapshi } from './passerelle-fapshi';

/**
 * Repli automatique de `direct-pay` vers `initiate-pay`.
 *
 * Fapshi n'ouvre `direct-pay` que sur demande, et refuse l'appel en 403 tant
 * que la fonction n'est pas activée. Le repli fait alors passer le paiement
 * par un lien hébergé, qui ne demande aucune activation.
 *
 * **Le point qui décide de tout est la condition du repli.** Un 403 signifie
 * que Fapshi a refusé la demande *avant* de la créer : rien n'existe chez
 * elle, et rejouer par un autre canal ne peut pas débiter deux fois. Un délai
 * dépassé, lui, laisse l'état **inconnu** — la demande a peut-être abouti —
 * et un second appel risquerait un double débit. C'est la différence que ces
 * tests verrouillent.
 */
describe('PasserelleFapshi — repli sur le lien de paiement', () => {
  let appels: { url: string; corps: unknown }[];
  let reponses: (() => Promise<Response>)[];
  let passerelle: PasserelleFapshi;

  const config = {
    get: (cle: string, defaut?: string) =>
      ({
        FAPSHI_BASE_URL: 'https://live.fapshi.test',
        CORS_ORIGIN: 'https://cocfet-app.test,https://autre.test',
      })[cle] ?? defaut,
    getOrThrow: () => 'secret',
  } as unknown as ConfigService;

  const demande: DemandePaiement = {
    reference: 'COCFET-0001',
    montant: 5000,
    methode: MethodePaiement.MTN_MOMO,
    telephone: '+237670000000',
    description: 'Commande boutique',
  };

  const repondre = (statut: number, corps: unknown) => () =>
    Promise.resolve({
      ok: statut >= 200 && statut < 300,
      status: statut,
      json: () => Promise.resolve(corps),
      text: () => Promise.resolve(JSON.stringify(corps)),
    } as Response);

  beforeEach(() => {
    appels = [];
    reponses = [];

    global.fetch = jest.fn((url: string, options?: { body?: string }) => {
      appels.push({
        url,
        corps: options?.body ? JSON.parse(options.body) : undefined,
      });
      const suivante = reponses.shift();
      if (!suivante) {
        throw new Error(`Appel inattendu : ${url}`);
      }
      return suivante();
    }) as unknown as typeof fetch;

    passerelle = new PasserelleFapshi(config);
  });

  const LIEN = 'https://checkout.fapshi.test/pay/abc123';

  it('bascule sur le lien de paiement quand direct-pay est refusé', async () => {
    reponses = [
      repondre(403, { message: 'Forbidden request.' }),
      repondre(200, { transId: 'trans_1', link: LIEN }),
    ];

    const resultat = await passerelle.initier(demande);

    expect(appels.map((a) => a.url)).toEqual([
      'https://live.fapshi.test/direct-pay',
      'https://live.fapshi.test/initiate-pay',
    ]);
    expect(resultat).toMatchObject({
      referenceExterne: 'trans_1',
      urlRedirection: LIEN,
      statut: StatutPaiement.EN_ATTENTE,
    });
  });

  it('ne demande ni numéro ni opérateur au lien de paiement', async () => {
    // La page hébergée les demande elle-même au payeur.
    reponses = [
      repondre(403, {}),
      repondre(200, { transId: 'trans_1', link: LIEN }),
    ];

    await passerelle.initier(demande);

    expect(appels[1].corps).toEqual({
      amount: 5000,
      externalId: 'COCFET-0001',
      message: 'Commande boutique',
      redirectUrl:
        'https://cocfet-app.test/paiement/retour?reference=COCFET-0001',
    });
  });

  it('ramène le payeur sur la première origine déclarée', async () => {
    // CORS_ORIGIN peut en porter plusieurs ; la page de retour doit être
    // unique et prévisible, sans quoi Fapshi renverrait n'importe où.
    reponses = [
      repondre(403, {}),
      repondre(200, { transId: 'trans_1', link: LIEN }),
    ];

    await passerelle.initier(demande);

    const corps = appels[1].corps as { redirectUrl: string };
    expect(corps.redirectUrl).toBe(
      'https://cocfet-app.test/paiement/retour?reference=COCFET-0001',
    );
  });

  it('ne rejoue rien quand le réseau a coupé', async () => {
    // L'état du paiement est inconnu : la demande a peut-être abouti. Un
    // second appel risquerait un double débit — c'est le défaut à ne jamais
    // commettre.
    reponses = [
      () => Promise.reject(new Error('réseau coupé')),
    ] as (() => Promise<Response>)[];

    await expect(passerelle.initier(demande)).rejects.toThrow(
      BadGatewayException,
    );
    expect(appels).toHaveLength(1);
  });

  it('ne rejoue rien sur un refus qui n’est pas un 403', async () => {
    reponses = [repondre(400, { message: 'Montant invalide' })];

    await expect(passerelle.initier(demande)).rejects.toThrow(
      BadGatewayException,
    );
    expect(appels).toHaveLength(1);
  });

  it('cesse d’essayer direct-pay après un refus', async () => {
    // Sans cette mémoire, chaque commande paierait un aller-retour inutile.
    reponses = [
      repondre(403, {}),
      repondre(200, { transId: 'trans_1', link: LIEN }),
      repondre(200, { transId: 'trans_2', link: LIEN }),
    ];

    await passerelle.initier(demande);
    await passerelle.initier(demande);

    expect(appels.map((a) => a.url)).toEqual([
      'https://live.fapshi.test/direct-pay',
      'https://live.fapshi.test/initiate-pay',
      'https://live.fapshi.test/initiate-pay',
    ]);
  });

  it('retente direct-pay une fois la mémoire du refus expirée', async () => {
    // Le jour où Fapshi active la fonction, la plateforme doit s'en
    // apercevoir seule, sans redémarrage.
    jest.useFakeTimers();
    try {
      reponses = [
        repondre(403, {}),
        repondre(200, { transId: 'trans_1', link: LIEN }),
        repondre(200, { transId: 'trans_2' }),
      ];

      await passerelle.initier(demande);
      jest.advanceTimersByTime(31 * 60_000);
      const resultat = await passerelle.initier(demande);

      expect(appels[2].url).toBe('https://live.fapshi.test/direct-pay');
      expect(resultat.urlRedirection).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('refuse une réponse de repli sans lien', async () => {
    // Un lien manquant laisserait la commande créée sans moyen de la régler.
    reponses = [repondre(403, {}), repondre(200, { transId: 'trans_1' })];

    await expect(passerelle.initier(demande)).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('laisse direct-pay travailler quand il est activé', async () => {
    reponses = [repondre(200, { transId: 'trans_direct' })];

    const resultat = await passerelle.initier(demande);

    expect(appels).toHaveLength(1);
    expect(resultat.urlRedirection).toBeNull();
    expect(resultat.referenceExterne).toBe('trans_direct');
  });
});
