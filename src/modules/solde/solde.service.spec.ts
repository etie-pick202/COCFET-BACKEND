import { SourceRetrait, StatutRetrait } from '../paiement/enums/paiement.enum';
import { ReleveSolde } from '../paiement/entities/releve-solde.entity';
import { Retrait } from '../paiement/entities/retrait.entity';
import { Transaction } from '../paiement/entities/transaction.entity';
import type {
  PasserellePaiement,
  RetraitFournisseur,
} from '../paiement/ports/passerelle-paiement';
import { SoldeService } from './solde.service';

/**
 * Le solde se lit chez Fapshi, les retraits s'y relisent un à un, et l'écart
 * avec nos encaissements est affiché plutôt que masqué.
 *
 * Les dépôts sont simulés : la requête de somme et l'`upsert` ont été
 * éprouvés sur un vrai PostgreSQL ; ce qui se verrouille ici, ce sont les
 * règles — quand relire, quand photographier, ce que « attendu » veut dire.
 */
describe('SoldeService', () => {
  let service: SoldeService;
  let solde: number;
  let trouves: RetraitFournisseur[];
  let releves: ReleveSolde[];
  let retraitsEnBase: Retrait[];
  let encaisseNet: number;
  let consulterSolde: jest.Mock;
  let listerRetraits: jest.Mock;
  let upsert: jest.Mock;

  const retrait = (
    surcharge: Partial<RetraitFournisseur> = {},
  ): RetraitFournisseur => ({
    referenceExterne: 'P1',
    montant: 12_000,
    statut: StatutRetrait.REUSSI,
    operateur: 'mobile money',
    beneficiaire: 'Trésorier',
    motif: null,
    referenceFinanciere: null,
    initieLe: new Date('2026-10-01T10:00:00Z'),
    confirmeLe: null,
    ...surcharge,
  });

  /** Somme des montants des retraits en base, pour un statut. */
  const somme = (statut: StatutRetrait): number =>
    retraitsEnBase
      .filter((r) => r.statut === statut)
      .reduce((total, r) => total + r.montant, 0);

  beforeEach(() => {
    solde = 15_000;
    encaisseNet = 15_000;
    trouves = [];
    releves = [];
    retraitsEnBase = [];

    consulterSolde = jest.fn(() => Promise.resolve({ solde, devise: 'XAF' }));
    listerRetraits = jest.fn(() => Promise.resolve(trouves));
    upsert = jest.fn((lignes: RetraitFournisseur[]) => {
      // Les sorties constatées n'appartiennent pas à Fapshi : une lecture ne
      // les efface pas.
      retraitsEnBase = [
        ...retraitsEnBase.filter((r) => r.source === SourceRetrait.CONSTATEE),
        ...lignes.map(
          (l, index) =>
            ({
              id: `r${index}`,
              note: null,
              source: SourceRetrait.FAPSHI,
              ...l,
            }) as Retrait,
        ),
      ];
      return Promise.resolve();
    });

    const requeteSomme = (donnees: () => number) => {
      const requete = {
        select: () => requete,
        where: () => requete,
        andWhere: () => requete,
        getRawOne: () => Promise.resolve({ somme: String(donnees()) }),
      };
      return requete;
    };
    let dernierStatut = StatutRetrait.REUSSI;

    const depotRetraits = {
      upsert,
      findOne: jest.fn(() =>
        Promise.resolve(
          retraitsEnBase.length > 0
            ? retraitsEnBase[retraitsEnBase.length - 1]
            : null,
        ),
      ),
      findOneBy: jest.fn(({ id }: { id: string }) =>
        Promise.resolve(retraitsEnBase.find((r) => r.id === id) ?? null),
      ),
      create: jest.fn(
        (donnees: Partial<Retrait>) =>
          ({
            id: `c${retraitsEnBase.length}`,
            note: null,
            ...donnees,
          }) as Retrait,
      ),
      save: jest.fn((r: Retrait) => {
        if (!retraitsEnBase.includes(r)) {
          retraitsEnBase.push(r);
        }
        return Promise.resolve(r);
      }),
      findAndCount: jest.fn(() =>
        Promise.resolve([retraitsEnBase, retraitsEnBase.length]),
      ),
      createQueryBuilder: () => {
        const requete = {
          select: () => requete,
          where: (_: string, parametres: { statut: StatutRetrait }) => {
            dernierStatut = parametres.statut;
            return requete;
          },
          getRawOne: () =>
            Promise.resolve({ somme: String(somme(dernierStatut)) }),
        };
        return requete;
      },
    };

    const depotReleves = {
      findOne: jest.fn(() =>
        Promise.resolve(releves.length > 0 ? releves[0] : null),
      ),
      create: jest.fn((donnees: Partial<ReleveSolde>) => ({
        id: `v${releves.length}`,
        createdAt: new Date(),
        ...donnees,
      })),
      save: jest.fn((releve: ReleveSolde) => {
        if (!releves.includes(releve)) {
          releves.unshift(releve);
        }
        return Promise.resolve(releve);
      }),
      find: jest.fn(() => Promise.resolve(releves)),
    };

    const depotTransactions = {
      findOne: jest.fn(() => Promise.resolve(null)),
      createQueryBuilder: () => requeteSomme(() => encaisseNet),
    };

    service = new SoldeService(
      depotRetraits as unknown as ConstructorParameters<typeof SoldeService>[0],
      depotReleves as unknown as ConstructorParameters<typeof SoldeService>[1],
      depotTransactions as unknown as ConstructorParameters<
        typeof SoldeService
      >[2] &
        Transaction,
      { consulterSolde, listerRetraits } as unknown as PasserellePaiement,
    );
  });

  it('affiche un écart nul quand tout s’explique', async () => {
    const etat = await service.etat();

    expect(etat).toMatchObject({
      soldeFapshi: 15_000,
      encaisseNet: 15_000,
      soldeAttendu: 15_000,
      ecart: 0,
      obsolete: false,
    });
  });

  it('suit un retrait fait chez Fapshi : le solde baisse, l’écart reste nul', async () => {
    solde = 3_000;
    trouves = [retrait()];

    const etat = await service.synchroniser().then(() => service.etat());

    expect(etat).toMatchObject({
      soldeFapshi: 3_000,
      retraitsReussis: 12_000,
      soldeAttendu: 3_000,
      ecart: 0,
    });
  });

  it('compte un retrait en cours comme déjà sorti', async () => {
    // Fapshi débite le compte à la demande : attendre l'issue ferait afficher
    // un écart de 12 000 pendant tout ce temps.
    solde = 3_000;
    trouves = [retrait({ statut: StatutRetrait.EN_COURS })];

    const etat = await service.synchroniser().then(() => service.etat());

    expect(etat).toMatchObject({
      retraitsReussis: 0,
      retraitsEnCours: 12_000,
      soldeAttendu: 3_000,
      ecart: 0,
    });
  });

  it('montre l’écart quand de l’argent a bougé sans retrait relevé', async () => {
    // 1 000 F ont quitté le compte sans retrait relevé : frais, prélèvement.
    solde = 14_000;

    const etat = await service.etat();

    expect(etat.ecart).toBe(-1_000);
  });

  it('ne remet pas un retrait à jour sans repasser par l’upsert, qui épargne la note', async () => {
    trouves = [retrait()];
    await service.synchroniser();

    const [lignes] = upsert.mock.calls[0] as [Record<string, unknown>[]];

    // `note` n'est pas dans ce qu'on écrit : l'upsert ne touche donc pas à la
    // colonne, et le motif saisi par le bureau survit à chaque lecture.
    expect(lignes[0]).not.toHaveProperty('note');
    expect(upsert).toHaveBeenCalledWith(expect.anything(), {
      conflictPaths: ['referenceExterne'],
      skipUpdateIfNoValuesChanged: true,
    });
  });

  it('n’ajoute pas de photographie quand rien n’a bougé', async () => {
    await service.synchroniser();
    await service.synchroniser();
    await service.synchroniser();

    expect(releves).toHaveLength(1);
  });

  it('ajoute une photographie quand le solde bouge', async () => {
    await service.synchroniser();
    solde = 9_000;
    await service.synchroniser();

    expect(releves.map((r) => r.soldeFapshi)).toEqual([9_000, 15_000]);
  });

  it('partage une lecture en cours entre appels simultanés', async () => {
    await Promise.all([
      service.synchroniser(),
      service.synchroniser(),
      service.synchroniser(),
    ]);

    // Cliquer plusieurs fois sur « Actualiser » ne triple pas les requêtes.
    expect(consulterSolde).toHaveBeenCalledTimes(1);
  });

  it('rend la dernière valeur connue, marquée obsolète, quand Fapshi ne répond pas', async () => {
    await service.etat();
    // La lecture est périmée : la suivante tentera Fapshi, qui échoue.
    releves[0].verifieLe = new Date(Date.now() - 10 * 60_000);
    consulterSolde.mockRejectedValueOnce(new Error('injoignable'));

    const etat = await service.etat();

    expect(etat).toMatchObject({ soldeFapshi: 15_000, obsolete: true });
  });

  it('échoue franchement quand Fapshi ne répond pas et qu’aucune lecture n’existe', async () => {
    consulterSolde.mockRejectedValueOnce(new Error('injoignable'));

    await expect(service.etat()).rejects.toThrow('injoignable');
  });

  it('n’interrompt pas le cron sur un échec', async () => {
    consulterSolde.mockRejectedValueOnce(new Error('injoignable'));

    await expect(service.synchroniserPeriodiquement()).resolves.toBeUndefined();
  });

  describe('baisse du solde constatée', () => {
    // Le service dont l'application détient les clés n'est pas le compte
    // principal de Fapshi : transférer vers ce compte puis retirer ne passe
    // par aucune route lisible. On constate la baisse plutôt que de la voir
    // comme un écart permanent.
    const DIX_MINUTES = 10 * 60_000;

    beforeEach(() => {
      jest.useFakeTimers({
        now: new Date('2026-10-05T10:00:00Z'),
        doNotFake: [
          'nextTick',
          'setImmediate',
          'setTimeout',
          'setInterval',
          'queueMicrotask',
        ],
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const constatees = () =>
      retraitsEnBase.filter((r) => r.source === SourceRetrait.CONSTATEE);

    it('ne constate pas dès la première lecture', async () => {
      solde = 0;

      await service.synchroniser();

      // Une seule lecture peut tomber entre la confirmation d'un paiement chez
      // nous et son crédit chez Fapshi : elle noterait une sortie inventée.
      expect(constatees()).toHaveLength(0);
      expect(releves[0].manqueDepuis).toEqual(new Date('2026-10-05T10:00:00Z'));
    });

    it('constate la baisse une fois qu’elle a duré', async () => {
      solde = 0;
      await service.synchroniser();
      jest.setSystemTime(new Date(Date.now() + DIX_MINUTES));

      await service.synchroniser();
      const etat = await service.etat();

      expect(constatees()).toHaveLength(1);
      expect(constatees()[0]).toMatchObject({
        montant: 15_000,
        statut: StatutRetrait.REUSSI,
        source: SourceRetrait.CONSTATEE,
        initieLe: new Date('2026-10-05T10:00:00Z'),
        confirmeLe: new Date('2026-10-05T10:10:00Z'),
      });
      // La sortie est comptée : l'écart redevient nul, et le solde attendu
      // épouse le solde réel.
      expect(etat).toMatchObject({
        retraitsReussis: 15_000,
        soldeAttendu: 0,
        ecart: 0,
      });
      expect(releves[0].manqueDepuis).toBeNull();
    });

    it('ne constate pas deux fois la même baisse', async () => {
      solde = 0;
      await service.synchroniser();
      jest.setSystemTime(new Date(Date.now() + DIX_MINUTES));
      await service.synchroniser();
      jest.setSystemTime(new Date(Date.now() + DIX_MINUTES));
      await service.synchroniser();
      await service.synchroniser();

      expect(constatees()).toHaveLength(1);
    });

    it('oublie un manque qui disparaît', async () => {
      solde = 0;
      await service.synchroniser();
      // Le paiement est enfin crédité chez Fapshi.
      solde = 15_000;
      jest.setSystemTime(new Date(Date.now() + DIX_MINUTES));

      await service.synchroniser();

      expect(constatees()).toHaveLength(0);
      expect(releves[0].manqueDepuis).toBeNull();
    });

    it('ignore un manque sous le seuil', async () => {
      // Fapshi arrondit ses frais autrement que nous : quelques francs par
      // paiement ne sont pas une sortie.
      solde = 14_950;
      await service.synchroniser();
      jest.setSystemTime(new Date(Date.now() + DIX_MINUTES));
      await service.synchroniser();

      expect(constatees()).toHaveLength(0);
    });

    it('ne constate pas un excédent : de l’argent entré hors application reste un écart', async () => {
      solde = 20_000;
      await service.synchroniser();
      jest.setSystemTime(new Date(Date.now() + DIX_MINUTES));
      await service.synchroniser();
      const etat = await service.etat();

      expect(constatees()).toHaveLength(0);
      expect(etat.ecart).toBe(5_000);
    });

    it('n’attend pas une sortie qui a déjà un retrait relevé', async () => {
      // Quand Fapshi expose le retrait, rien n'est à constater en plus.
      solde = 3_000;
      trouves = [retrait()];

      await service.synchroniser();
      jest.setSystemTime(new Date(Date.now() + DIX_MINUTES));
      await service.synchroniser();

      expect(constatees()).toHaveLength(0);
    });
  });

  describe('annoter', () => {
    beforeEach(() => {
      retraitsEnBase = [
        { id: 'r0', note: null, montant: 1000 } as unknown as Retrait,
      ];
    });

    it('consigne le motif', async () => {
      const retraitNote = await service.annoter('r0', '  Avance traiteur ');

      expect(retraitNote?.note).toBe('Avance traiteur');
    });

    it('efface la note quand elle est vide', async () => {
      const retraitNote = await service.annoter('r0', '   ');

      expect(retraitNote?.note).toBeNull();
    });

    it('rend nul pour un retrait inconnu', async () => {
      await expect(service.annoter('inconnu', 'x')).resolves.toBeNull();
    });
  });
});
