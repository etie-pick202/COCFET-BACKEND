import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StatutRetrait } from '../enums/paiement.enum';
import { PasserelleFapshi } from './passerelle-fapshi';

/**
 * Solde du compte et retraits, lus chez Fapshi.
 *
 * `GET /search` rend toutes les transactions — encaissements compris — bornées
 * à cent, sans pagination. Ce qui se verrouille ici : ne garder que les
 * sorties d'argent, ne jamais inventer un solde, et ne pas perdre de retrait
 * quand une fenêtre déborde.
 */
describe('PasserelleFapshi — solde et retraits', () => {
  let appels: string[];
  let reponses: (() => unknown)[];
  let passerelle: PasserelleFapshi;

  const config = {
    get: (cle: string, defaut?: string) =>
      ({ FAPSHI_BASE_URL: 'https://live.fapshi.test' })[cle] ?? defaut,
    getOrThrow: () => 'secret',
  } as unknown as ConfigService;

  const repondre =
    (corps: unknown, statut = 200) =>
    () =>
      Promise.resolve({
        ok: statut < 400,
        status: statut,
        json: () => Promise.resolve(corps),
      } as Response);

  const payout = (id: string, surcharge: Record<string, unknown> = {}) => ({
    transId: id,
    transType: 'Payout',
    status: 'SUCCESSFUL',
    amount: 12_000,
    medium: 'mobile money',
    payerName: 'Trésorier',
    reason: 'Avance traiteur',
    financialTransId: 'MP123',
    dateInitiated: '2026-10-01T10:00:00.000Z',
    dateConfirmed: '2026-10-01T10:02:00.000Z',
    ...surcharge,
  });

  const collection = (id: string) => ({
    transId: id,
    transType: 'Collection',
    status: 'SUCCESSFUL',
    amount: 5_000,
    dateInitiated: '2026-10-01T09:00:00.000Z',
  });

  beforeEach(() => {
    appels = [];
    reponses = [];

    global.fetch = jest.fn((url: string) => {
      appels.push(url);
      const suivante = reponses.shift();
      if (!suivante) {
        throw new Error(`Appel inattendu : ${url}`);
      }
      return suivante();
    }) as unknown as typeof fetch;

    passerelle = new PasserelleFapshi(config);
  });

  describe('consulterSolde', () => {
    it('rend le solde et la devise', async () => {
      reponses = [
        repondre({ service: 'cocfet', balance: 48_250, currency: 'XAF' }),
      ];

      await expect(passerelle.consulterSolde()).resolves.toEqual({
        solde: 48_250,
        devise: 'XAF',
      });
      expect(appels).toEqual(['https://live.fapshi.test/balance']);
    });

    it('refuse un solde absent plutôt que de l’inventer', async () => {
      // Un solde à zéro par défaut serait affiché, comparé à nos
      // encaissements, et ferait conclure à un retrait qui n'a pas eu lieu.
      reponses = [repondre({ service: 'cocfet' })];

      await expect(passerelle.consulterSolde()).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('remonte un refus de Fapshi', async () => {
      reponses = [repondre({ message: 'Forbidden' }, 403)];

      await expect(passerelle.consulterSolde()).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    });
  });

  describe('listerRetraits', () => {
    const depuis = new Date('2026-10-01T00:00:00Z');
    const jusqua = new Date('2026-10-05T00:00:00Z');

    it('ne garde que les sorties d’argent', async () => {
      reponses = [repondre([collection('C1'), payout('P1'), collection('C2')])];

      const retraits = await passerelle.listerRetraits(depuis, jusqua);

      expect(retraits).toHaveLength(1);
      expect(retraits[0]).toMatchObject({
        referenceExterne: 'P1',
        montant: 12_000,
        statut: StatutRetrait.REUSSI,
        operateur: 'mobile money',
        beneficiaire: 'Trésorier',
        motif: 'Avance traiteur',
        referenceFinanciere: 'MP123',
      });
      expect(retraits[0].initieLe).toEqual(new Date('2026-10-01T10:00:00Z'));
      expect(retraits[0].confirmeLe).toEqual(new Date('2026-10-01T10:02:00Z'));
    });

    it('borne la fenêtre par date et demande cent résultats', async () => {
      reponses = [repondre([])];

      await passerelle.listerRetraits(depuis, jusqua);

      expect(appels).toEqual([
        'https://live.fapshi.test/search?start=2026-10-01&end=2026-10-05&limit=100&sort=desc',
      ]);
    });

    it.each([
      ['CREATED', StatutRetrait.EN_COURS],
      ['PENDING', StatutRetrait.EN_COURS],
      ['SUCCESSFUL', StatutRetrait.REUSSI],
      ['FAILED', StatutRetrait.ECHOUE],
      ['EXPIRED', StatutRetrait.ECHOUE],
      ['QUELQUE_CHOSE_DE_NEUF', StatutRetrait.EN_COURS],
    ])('traduit le statut « %s »', async (statut, attendu) => {
      // Un statut inconnu reste « en cours » : le retrait est enregistré et
      // relu à la lecture suivante, au lieu de faire échouer toute la liste.
      reponses = [repondre([payout('P1', { status: statut })])];

      const [retrait] = await passerelle.listerRetraits(depuis, jusqua);

      expect(retrait.statut).toBe(attendu);
    });

    it('laisse la confirmation vide tant que le retrait n’a pas abouti', async () => {
      reponses = [
        repondre([
          payout('P1', { status: 'PENDING', dateConfirmed: undefined }),
        ]),
      ];

      const [retrait] = await passerelle.listerRetraits(depuis, jusqua);

      expect(retrait.confirmeLe).toBeNull();
    });

    it('écarte une ligne illisible sans faire échouer les autres', async () => {
      reponses = [
        repondre([
          payout('P1', { amount: 'beaucoup' }),
          payout('P2', { dateInitiated: 'pas une date' }),
          payout('P3'),
        ]),
      ];

      const retraits = await passerelle.listerRetraits(depuis, jusqua);

      expect(retraits.map((r) => r.referenceExterne)).toEqual(['P3']);
    });

    it('coupe en deux une fenêtre qui rend cent résultats, sans perdre de retrait', async () => {
      // Cent résultats : la liste est peut-être tronquée côté Fapshi.
      const pleine = Array.from({ length: 100 }, (_, i) => collection(`C${i}`));
      reponses = [
        repondre(pleine),
        repondre([payout('P1')]),
        repondre([payout('P2'), payout('P1')]),
      ];

      const retraits = await passerelle.listerRetraits(depuis, jusqua);

      expect(appels).toHaveLength(3);
      // P1 figure dans les deux moitiés qui se chevauchent : un seul exemplaire.
      expect(
        retraits
          .map((r) => r.referenceExterne)
          .sort((a, b) => a.localeCompare(b)),
      ).toEqual(['P1', 'P2']);
    });

    it('s’arrête à la journée au lieu de boucler', async () => {
      const pleine = Array.from({ length: 100 }, (_, i) => collection(`C${i}`));
      reponses = [repondre(pleine)];

      await passerelle.listerRetraits(
        new Date('2026-10-01T00:00:00Z'),
        new Date('2026-10-01T23:00:00Z'),
      );

      expect(appels).toHaveLength(1);
    });

    it('refuse une réponse qui n’est pas une liste', async () => {
      reponses = [repondre({ message: 'oups' })];

      await expect(
        passerelle.listerRetraits(depuis, jusqua),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });
});
