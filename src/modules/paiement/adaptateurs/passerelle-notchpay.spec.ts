import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes } from 'node:crypto';
import { MethodePaiement, StatutPaiement } from '../enums/paiement.enum';
import { DemandePaiement } from '../ports/passerelle-paiement';
import { PasserelleNotchPay } from './passerelle-notchpay';

/**
 * Genere plutot qu'ecrit en dur : une valeur litterale ressemble a un secret
 * oublie dans le code, et l'analyse statique la signale a juste titre. Ce
 * qu'on teste ne depend pas de sa valeur.
 */
const SECRET_WEBHOOK = randomBytes(16).toString('hex');

/**
 * L'API NotchPay est simulée : le compte marchand n'est pas ouvert, et ces
 * tests ne pourraient de toute façon pas dépendre d'un service tiers.
 *
 * Ce qui est vérifié ici, c'est **notre** comportement : ce que nous envoyons,
 * comment nous interprétons les réponses, et surtout ce que nous refusons.
 * Les libellés exacts restent à confirmer contre l'API réelle — mais la
 * gestion d'erreur, elle, ne dépend pas d'eux.
 */
describe('PasserelleNotchPay', () => {
  let passerelle: PasserelleNotchPay;
  let appels: { url: string; init: RequestInit }[];

  const config = {
    get: (cle: string, defaut?: string) =>
      cle === 'NOTCHPAY_BASE_URL' ? 'https://api.test' : defaut,
    getOrThrow: (cle: string) =>
      ({
        NOTCHPAY_PUBLIC_KEY: 'pk_test',
        NOTCHPAY_SECRET_KEY: 'sk_test',
        NOTCHPAY_WEBHOOK_SECRET: SECRET_WEBHOOK,
      })[cle]!,
  } as unknown as ConfigService;

  const repondre = (corps: unknown, status = 200) => {
    global.fetch = jest.fn((url: string, init: RequestInit) => {
      appels.push({ url, init });
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(corps),
      });
    }) as unknown as typeof fetch;
  };

  const demande = (
    surcharge: Partial<DemandePaiement> = {},
  ): DemandePaiement => ({
    reference: 'COCFET-A1B2C3D4E5F6',
    montant: 5000,
    methode: MethodePaiement.MTN_MOMO,
    telephone: '+237699000002',
    description: 'Billet gala',
    ...surcharge,
  });

  const signer = (corps: object) => {
    const brut = Buffer.from(JSON.stringify(corps));
    return {
      brut,
      signature: createHmac('sha256', SECRET_WEBHOOK)
        .update(brut)
        .digest('hex'),
    };
  };

  beforeEach(() => {
    appels = [];
    passerelle = new PasserelleNotchPay(config);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initiation', () => {
    it('transmet le montant, la devise et notre référence', async () => {
      repondre({
        transaction: { reference: 'trx_123', status: 'pending' },
        authorization_url: 'https://pay.test/abc',
      });

      const resultat = await passerelle.initier(demande());

      expect(appels).toHaveLength(1);
      const corps = JSON.parse(appels[0].init.body as string) as {
        amount: number;
        currency: string;
        reference: string;
      };
      // La devise est figée : nos montants sont des entiers de FCFA.
      expect(corps).toMatchObject({
        amount: 5000,
        currency: 'XAF',
        reference: 'COCFET-A1B2C3D4E5F6',
      });
      expect(resultat.statut).toBe(StatutPaiement.EN_ATTENTE);
      expect(resultat.urlRedirection).toBe('https://pay.test/abc');
    });

    it('présente les deux clés d’authentification', async () => {
      repondre({ transaction: { status: 'pending' } });

      await passerelle.initier(demande());

      const entetes = appels[0].init.headers as Record<string, string>;
      expect(entetes.Authorization).toBe('pk_test');
      expect(entetes['X-Grant']).toBe('sk_test');
    });

    it('refuse un montant décimal sans appeler le prestataire', async () => {
      repondre({});

      await expect(
        passerelle.initier(demande({ montant: 1500.5 })),
      ).rejects.toThrow(BadRequestException);
      expect(appels).toHaveLength(0);
    });

    it('ne présente jamais l’erreur du prestataire à l’utilisateur', async () => {
      // Le corps d'erreur peut contenir des détails d'intégration ; il est
      // journalisé, pas renvoyé.
      repondre({ message: 'invalid channel cm.mtn for merchant 42' }, 400);

      await expect(passerelle.initier(demande())).rejects.toThrow(
        /n’a pas pu être initié/,
      );
    });

    it('signale une indisponibilité plutôt qu’un échec de paiement', async () => {
      // Réseau coupé : l'état du paiement est **inconnu**. Le déclarer échoué
      // rendrait la place alors que le débit a peut-être eu lieu.
      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));

      await expect(passerelle.initier(demande())).rejects.toThrow(
        BadGatewayException,
      );
    });
  });

  describe('interprétation des statuts', () => {
    it.each([
      ['complete', StatutPaiement.COMPLETE],
      ['successful', StatutPaiement.COMPLETE],
      ['pending', StatutPaiement.EN_ATTENTE],
      ['failed', StatutPaiement.ECHOUE],
      ['canceled', StatutPaiement.ECHOUE],
      ['expired', StatutPaiement.ECHOUE],
    ])('traduit « %s »', async (libelle, attendu) => {
      repondre({ transaction: { status: libelle } });

      await expect(passerelle.verifier('COCFET-1')).resolves.toMatchObject({
        statut: attendu,
      });
    });

    it('lève sur un statut inconnu au lieu de deviner', async () => {
      // Ranger par défaut en « complété » livrerait des billets non payés ;
      // en « en attente » masquerait un échec.
      repondre({ transaction: { status: 'quelque_chose_de_nouveau' } });

      await expect(passerelle.verifier('COCFET-1')).rejects.toThrow(
        BadGatewayException,
      );
    });
  });

  describe('webhook', () => {
    const charge = (surcharge: Record<string, unknown> = {}) => ({
      data: {
        merchant_reference: 'COCFET-A1B2C3D4E5F6',
        reference: 'trx_123',
        status: 'complete',
        ...surcharge,
      },
    });

    it('accepte une notification correctement signée', () => {
      const { brut, signature } = signer(charge());

      expect(passerelle.interpreterWebhook(brut, signature)).toEqual({
        reference: 'COCFET-A1B2C3D4E5F6',
        referenceExterne: 'trx_123',
        statut: StatutPaiement.COMPLETE,
      });
    });

    it('refuse une notification non signée', () => {
      // Sans ce contrôle, n'importe qui pourrait déclarer une commande payée.
      const { brut } = signer(charge());

      expect(() => passerelle.interpreterWebhook(brut)).toThrow(
        BadRequestException,
      );
    });

    it('refuse un corps modifié après signature', () => {
      // Le scénario réel : rejouer une notification légitime en remplaçant le
      // statut par « complete ».
      const legitime = signer(charge({ status: 'failed' }));
      const falsifie = Buffer.from(
        JSON.stringify(charge({ status: 'complete' })),
      );

      expect(() =>
        passerelle.interpreterWebhook(falsifie, legitime.signature),
      ).toThrow(BadRequestException);
    });

    it('refuse une signature d’une autre longueur sans lever de comparaison', () => {
      const { brut } = signer(charge());

      expect(() => passerelle.interpreterWebhook(brut, 'trop-court')).toThrow(
        BadRequestException,
      );
    });

    it('refuse un corps illisible', () => {
      const brut = Buffer.from('ceci n’est pas du JSON');
      const signature = createHmac('sha256', SECRET_WEBHOOK)
        .update(brut)
        .digest('hex');

      expect(() => passerelle.interpreterWebhook(brut, signature)).toThrow(
        BadRequestException,
      );
    });

    it('refuse une notification sans référence exploitable', () => {
      const { brut, signature } = signer({ data: { status: 'complete' } });

      expect(() => passerelle.interpreterWebhook(brut, signature)).toThrow(
        /référence/,
      );
    });

    it('accepte une charge non enveloppée dans « data »', () => {
      // La forme exacte reste à confirmer : les deux sont acceptées.
      const { brut, signature } = signer({
        merchant_reference: 'COCFET-XYZ',
        reference: 'trx_9',
        status: 'complete',
      });

      expect(passerelle.interpreterWebhook(brut, signature).reference).toBe(
        'COCFET-XYZ',
      );
    });
  });
});
