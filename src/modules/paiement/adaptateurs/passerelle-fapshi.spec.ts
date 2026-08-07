import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MethodePaiement, StatutPaiement } from '../enums/paiement.enum';
import { DemandePaiement } from '../ports/passerelle-paiement';
import { PasserelleFapshi } from './passerelle-fapshi';

const SECRET = 'secret-de-webhook';
const BASE = 'https://sandbox.test';

describe('PasserelleFapshi', () => {
  let passerelle: PasserelleFapshi;
  let appels: { url: string; init: RequestInit }[];

  const config = {
    get: (cle: string, defaut?: string) =>
      cle === 'FAPSHI_BASE_URL' ? BASE : defaut,
    getOrThrow: (cle: string) =>
      ({
        FAPSHI_API_USER: 'utilisateur',
        FAPSHI_API_KEY: 'cle',
        FAPSHI_WEBHOOK_SECRET: SECRET,
      })[cle],
  } as unknown as ConfigService;

  /** Programme les réponses HTTP, dans l'ordre où elles seront consommées. */
  const repondre = (...reponses: { statut?: number; corps: unknown }[]) => {
    const file = [...reponses];

    global.fetch = jest.fn((url: string, init: RequestInit) => {
      appels.push({ url, init });
      const suivante = file.shift() ?? { corps: {} };

      return Promise.resolve({
        ok: (suivante.statut ?? 200) < 400,
        status: suivante.statut ?? 200,
        json: () => Promise.resolve(suivante.corps),
      });
    }) as unknown as typeof fetch;
  };

  const demande = (
    surcharge: Partial<DemandePaiement> = {},
  ): DemandePaiement => ({
    reference: 'COCFET-0001',
    montant: 5000,
    methode: MethodePaiement.MTN_MOMO,
    telephone: '+237670000000',
    description: 'Billet gala',
    ...surcharge,
  });

  const entetes = (secret = SECRET) => ({ 'x-wh-secret': secret });

  beforeEach(() => {
    appels = [];
    passerelle = new PasserelleFapshi(config);
  });

  describe('initier', () => {
    it('appelle direct-pay et rend le transId', async () => {
      repondre({ corps: { transId: 'trx_1', dateInitiated: '2027-08-12' } });

      const resultat = await passerelle.initier(demande());

      expect(appels[0].url).toBe(`${BASE}/direct-pay`);
      expect(resultat.referenceExterne).toBe('trx_1');
      // `direct-pay` accuse réception sans trancher : annoncer un succès ici
      // confirmerait un billet avant tout débit.
      expect(resultat.statut).toBe(StatutPaiement.EN_ATTENTE);
      expect(resultat.urlRedirection).toBeNull();
    });

    it('s’authentifie par apiuser et apikey', async () => {
      repondre({ corps: { transId: 'trx_1' } });

      await passerelle.initier(demande());

      expect(appels[0].init.headers).toMatchObject({
        apiuser: 'utilisateur',
        apikey: 'cle',
      });
    });

    it('ramène le numéro au format local attendu', async () => {
      repondre({ corps: { transId: 'trx_1' } });

      await passerelle.initier(demande({ telephone: '+237 670 000 000' }));

      // Fapshi refuse la forme internationale : convertir ici évite d'imposer
      // sa contrainte à tous les appelants.
      expect(JSON.parse(appels[0].init.body as string)).toMatchObject({
        phone: '670000000',
        externalId: 'COCFET-0001',
        medium: 'mobile money',
      });
    });

    it('distingue Orange Money', async () => {
      repondre({ corps: { transId: 'trx_1' } });

      await passerelle.initier(
        demande({ methode: MethodePaiement.ORANGE_MONEY }),
      );

      expect(JSON.parse(appels[0].init.body as string)).toMatchObject({
        medium: 'orange money',
      });
    });

    it('refuse un numéro inexploitable sans appeler le prestataire', async () => {
      repondre({ corps: {} });

      await expect(
        passerelle.initier(demande({ telephone: '12345' })),
      ).rejects.toThrow(BadRequestException);
      expect(appels).toHaveLength(0);
    });

    it('refuse un montant sous le minimum de Fapshi', async () => {
      repondre({ corps: {} });

      // Contrôlé chez nous : le refus du prestataire arriverait en 400
      // générique, sans dire à la personne ce qui cloche.
      await expect(
        passerelle.initier(demande({ montant: 50 })),
      ).rejects.toThrow(BadRequestException);
      expect(appels).toHaveLength(0);
    });

    it('refuse un montant décimal', async () => {
      repondre({ corps: {} });

      await expect(
        passerelle.initier(demande({ montant: 1500.5 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('signale une réponse sans transId plutôt que de l’inventer', async () => {
      repondre({ corps: { message: 'ok' } });

      await expect(passerelle.initier(demande())).rejects.toThrow(
        BadGatewayException,
      );
    });

    it('ne conclut pas à l’échec quand le prestataire est injoignable', async () => {
      // L'état du paiement est alors **inconnu** : le déclarer échoué
      // libérerait une place peut-être déjà payée.
      global.fetch = jest.fn().mockRejectedValue(new Error('réseau'));

      await expect(passerelle.initier(demande())).rejects.toThrow(
        BadGatewayException,
      );
    });
  });

  describe('verifier', () => {
    it.each([
      ['SUCCESSFUL', StatutPaiement.COMPLETE],
      ['PENDING', StatutPaiement.EN_ATTENTE],
      ['CREATED', StatutPaiement.EN_ATTENTE],
      ['FAILED', StatutPaiement.ECHOUE],
      // Expiré vaut échec : attendre indéfiniment bloquerait la place.
      ['EXPIRED', StatutPaiement.ECHOUE],
    ])('traduit %s', async (statut, attendu) => {
      repondre({ corps: { transId: 'trx_1', externalId: 'COCFET-1', statut } });
      repondre({
        corps: { transId: 'trx_1', externalId: 'COCFET-1', status: statut },
      });

      await expect(passerelle.verifier('trx_1')).resolves.toMatchObject({
        statut: attendu,
        reference: 'COCFET-1',
      });
    });

    it('lève sur un statut inconnu plutôt que de choisir par défaut', async () => {
      // Ranger l'inconnu dans « payé » livrerait des billets non réglés ;
      // dans « en attente », cela masquerait un échec.
      repondre({ corps: { transId: 'trx_1', status: 'QUELQUE_CHOSE' } });

      await expect(passerelle.verifier('trx_1')).rejects.toThrow(
        BadGatewayException,
      );
    });
  });

  describe('interpreterWebhook', () => {
    const corps = (statut: string) =>
      Buffer.from(JSON.stringify({ transId: 'trx_1', status: statut }));

    it('refuse une notification sans secret', async () => {
      repondre({ corps: {} });

      await expect(
        passerelle.interpreterWebhook(corps('SUCCESSFUL'), {}),
      ).rejects.toThrow(BadRequestException);
      expect(appels).toHaveLength(0);
    });

    it('refuse une notification au mauvais secret', async () => {
      repondre({ corps: {} });

      await expect(
        passerelle.interpreterWebhook(
          corps('SUCCESSFUL'),
          entetes('pas-le-bon'),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(appels).toHaveLength(0);
    });

    it('ne croit pas le statut annoncé et redemande à Fapshi', async () => {
      // Le cœur du dispositif. Fapshi ne signe pas ses octets : qui obtient
      // le secret peut forger un « paiement réussi ». La seconde question
      // rend cette notification inoffensive.
      repondre({
        corps: {
          transId: 'trx_1',
          externalId: 'COCFET-0001',
          status: 'FAILED',
        },
      });

      const evenement = await passerelle.interpreterWebhook(
        corps('SUCCESSFUL'),
        entetes(),
      );

      expect(appels[0].url).toBe(`${BASE}/payment-status/trx_1`);
      expect(evenement.statut).toBe(StatutPaiement.ECHOUE);
      expect(evenement.reference).toBe('COCFET-0001');
    });

    it('refuse une notification sans transaction', async () => {
      repondre({ corps: {} });

      await expect(
        passerelle.interpreterWebhook(
          Buffer.from(JSON.stringify({ status: 'SUCCESSFUL' })),
          entetes(),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuse un corps illisible', async () => {
      repondre({ corps: {} });

      await expect(
        passerelle.interpreterWebhook(Buffer.from('pas du json'), entetes()),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
