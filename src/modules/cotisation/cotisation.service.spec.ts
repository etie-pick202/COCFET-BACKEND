import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { GenerationService } from '../generation/generation.service';
import { AlerteTresorerieService } from '../notification/alerte-tresorerie.service';
import { NotificationService } from '../notification/notification.service';
import {
  OrigineTransaction,
  Transaction,
} from '../paiement/entities/transaction.entity';
import {
  MethodePaiement,
  StatutPaiement,
} from '../paiement/enums/paiement.enum';
import type { PasserellePaiement } from '../paiement/ports/passerelle-paiement';
import { TransactionService } from '../paiement/transaction.service';
import { User } from '../user/entities/user.entity';
import { CotisationService } from './cotisation.service';
import { LIBELLE_TOTALITE } from './echeances';
import {
  CibleCotisation,
  Cotisation,
  StatutCotisation,
} from './entities/cotisation.entity';
import {
  ParticipationCotisation,
  StatutParticipation,
} from './entities/participation-cotisation.entity';
import {
  ModeReglement,
  ReglementCotisation,
} from './entities/reglement-cotisation.entity';
import { TrancheCotisation } from './entities/tranche-cotisation.entity';
import { VersementFinance } from './entities/versement-finance.entity';

/**
 * Ce que le banc de bout en bout ne couvre pas.
 *
 * Deux points valent une attention particulière : le **règlement incrémenté en
 * base** plutôt que lu puis réécrit — deux paiements simultanés s'écraseraient
 * sinon — et la **traduction des populations**, où confondre un rôle avec un
 * statut ferait cotiser les mauvaises personnes.
 */
describe('CotisationService', () => {
  let service: CotisationService;
  let cotisations: Record<string, jest.Mock>;
  let participations: Record<string, jest.Mock>;
  let versements: Record<string, jest.Mock>;
  let constructeur: Record<string, jest.Mock>;
  let trouverActive: jest.Mock;
  let reglements: Record<string, jest.Mock>;
  let notifications: Record<string, jest.Mock>;
  let alertes: Record<string, jest.Mock>;
  let transactions: Record<string, jest.Mock>;
  let passerelle: Record<string, jest.Mock>;

  const cotisation = (surcharge: Partial<Cotisation> = {}): Cotisation =>
    ({
      id: 'c1',
      titre: 'Cotisation',
      montantTotal: 30_000,
      cibles: [CibleCotisation.FINISSANT],
      statut: StatutCotisation.BROUILLON,
      tranches: [],
      ...surcharge,
    }) as Cotisation;

  beforeEach(() => {
    constructeur = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    cotisations = {
      findOne: jest.fn().mockResolvedValue(cotisation()),
      save: jest
        .fn()
        .mockImplementation((c: Cotisation) => ({ ...c, id: 'c1' })),
      create: jest.fn().mockImplementation((c: Partial<Cotisation>) => c),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
    };
    participations = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findOneOrFail: jest.fn(),
      save: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((p: unknown) => p),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    versements = {
      save: jest.fn().mockImplementation((v: unknown) => v),
      create: jest.fn().mockImplementation((v: unknown) => v),
      find: jest.fn().mockResolvedValue([]),
    };
    trouverActive = jest.fn().mockResolvedValue({ annee: 2027 });
    reglements = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      findOneOrFail: jest
        .fn()
        .mockImplementation(() => Promise.resolve({ id: 'r1' })),
      save: jest
        .fn()
        .mockImplementation((r: object) => Promise.resolve({ ...r, id: 'r1' })),
      create: jest.fn().mockImplementation((r: unknown) => r),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    notifications = {
      notifier: jest.fn().mockResolvedValue(null),
      notifierPlusieurs: jest.fn().mockResolvedValue(0),
    };
    alertes = {
      encaissement: jest.fn().mockResolvedValue(undefined),
      preuveADecider: jest.fn().mockResolvedValue(undefined),
    };
    transactions = {
      ouvrir: jest.fn().mockResolvedValue({}),
      enregistrerReferenceExterne: jest.fn().mockResolvedValue(undefined),
      abandonner: jest.fn().mockResolvedValue(true),
      appliquer: jest.fn().mockResolvedValue(true),
      trouver: jest.fn().mockResolvedValue(null),
    };
    passerelle = {
      initier: jest.fn().mockResolvedValue({
        reference: 'x',
        referenceExterne: 'ext-1',
        statut: StatutPaiement.EN_ATTENTE,
        urlRedirection: null,
      }),
      expirer: jest.fn().mockResolvedValue(undefined),
    };

    service = new CotisationService(
      cotisations as unknown as Repository<Cotisation>,
      {
        delete: jest.fn(),
        save: jest.fn(),
        create: jest.fn(),
      } as unknown as Repository<TrancheCotisation>,
      participations as unknown as Repository<ParticipationCotisation>,
      versements as unknown as Repository<VersementFinance>,
      reglements as unknown as Repository<ReglementCotisation>,
      {
        createQueryBuilder: jest.fn().mockReturnValue(constructeur),
        findOne: jest.fn().mockResolvedValue({ id: 'u1' }),
      } as unknown as Repository<User>,
      { trouverActive } as unknown as GenerationService,
      notifications as unknown as NotificationService,
      alertes as unknown as AlerteTresorerieService,
      transactions as unknown as TransactionService,
      passerelle as unknown as PasserellePaiement,
      { get: () => undefined } as unknown as ConfigService,
    );
  });

  describe('échéancier', () => {
    const creer = (tranches: { ordre: number; montant: number }[]) =>
      service.creer({
        titre: 'Cotisation',
        montantTotal: 30_000,
        cibles: [CibleCotisation.FINISSANT],
        tranches: tranches.map((t) => ({
          ...t,
          libelle: `T${t.ordre}`,
          dateLimite: '2099-01-01T00:00:00.000Z',
        })),
      });

    it('refuse un total qui ne correspond pas', async () => {
      await expect(creer([{ ordre: 1, montant: 5_000 }])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuse deux tranches de même rang', async () => {
      // Leur consommation serait indéterminée.
      await expect(
        creer([
          { ordre: 1, montant: 15_000 },
          { ordre: 1, montant: 15_000 },
        ]),
      ).rejects.toThrow(/même ordre/);
    });

    it('accepte un échéancier exact', async () => {
      await expect(
        creer([
          { ordre: 1, montant: 10_000 },
          { ordre: 2, montant: 20_000 },
        ]),
      ).resolves.toBeDefined();
    });
  });

  describe('règlement', () => {
    it('incrémente en base plutôt que de lire puis écrire', async () => {
      // Un paiement en ligne et la validation d'un justificatif peuvent
      // survenir en même temps : les lire tous deux avant d'écrire ferait
      // perdre le premier.
      participations.findOne.mockResolvedValue({ id: 'p1' });
      participations.findOneOrFail.mockResolvedValue({
        montantRegle: 10_000,
        montantDu: 30_000,
        statut: StatutParticipation.EN_COURS,
      });

      await service.enregistrerReglement('p1', 10_000);

      expect(participations.increment).toHaveBeenCalledWith(
        { id: 'p1' },
        'montantRegle',
        10_000,
      );
    });

    it('solde la participation une fois le dû atteint', async () => {
      participations.findOne.mockResolvedValue({ id: 'p1' });
      participations.findOneOrFail.mockResolvedValue({
        montantRegle: 30_000,
        montantDu: 30_000,
        statut: StatutParticipation.EN_COURS,
      });

      await service.enregistrerReglement('p1', 20_000);

      expect(participations.update).toHaveBeenCalledWith('p1', {
        statut: StatutParticipation.SOLDEE,
      });
    });

    it('ne solde pas tant qu’il reste à verser', async () => {
      participations.findOne.mockResolvedValue({ id: 'p1' });
      participations.findOneOrFail.mockResolvedValue({
        montantRegle: 10_000,
        montantDu: 30_000,
        statut: StatutParticipation.EN_COURS,
      });

      await service.enregistrerReglement('p1', 10_000);

      expect(participations.update).not.toHaveBeenCalled();
    });

    it('ignore une participation inconnue sans lever', async () => {
      // Le webhook ne doit pas échouer sur une référence disparue : il
      // renverrait une erreur au prestataire, qui rejouerait indéfiniment.
      await expect(
        service.enregistrerReglement('inconnue', 5_000),
      ).resolves.toBeUndefined();
      expect(participations.increment).not.toHaveBeenCalled();
    });
  });

  describe('cycle de vie', () => {
    it('refuse de modifier une cotisation ouverte', async () => {
      cotisations.findOne.mockResolvedValue(
        cotisation({ statut: StatutCotisation.OUVERTE }),
      );

      await expect(
        service.mettreAJour('c1', { montantTotal: 50_000 }),
      ).rejects.toThrow(ConflictException);
    });

    it('refuse d’ouvrir une cotisation close', async () => {
      cotisations.findOne.mockResolvedValue(
        cotisation({ statut: StatutCotisation.CLOSE }),
      );

      await expect(service.ouvrir('c1')).rejects.toThrow(ConflictException);
    });

    it('refuse d’ouvrir sans population visée', async () => {
      cotisations.findOne.mockResolvedValue(cotisation({ cibles: [] }));

      await expect(service.ouvrir('c1')).rejects.toThrow(BadRequestException);
    });

    it('refuse de supprimer une cotisation ouverte', async () => {
      cotisations.findOne.mockResolvedValue(
        cotisation({ statut: StatutCotisation.OUVERTE }),
      );

      await expect(service.supprimer('c1')).rejects.toThrow(ConflictException);
    });

    it('supprime un brouillon', async () => {
      await service.supprimer('c1');

      expect(cotisations.delete).toHaveBeenCalledWith('c1');
    });
  });

  describe('populations visées', () => {
    const ouvrirAvec = async (cibles: CibleCotisation[]) => {
      cotisations.findOne.mockResolvedValue(cotisation({ cibles }));
      await service.ouvrir('c1');
      return (constructeur.andWhere.mock.calls[0] ?? []) as [
        string,
        Record<string, unknown>,
      ];
    };

    it('reconnaît le finissant à son statut, non à son rôle', async () => {
      // « Finissant » est calculé depuis la promotion et le mandat : le
      // confondre avec STUDENT ferait cotiser toute l'école.
      const [condition] = await ouvrirAvec([CibleCotisation.FINISSANT]);

      expect(condition).toContain('is_finissant');
    });

    it('cumule plusieurs cibles', async () => {
      const [condition] = await ouvrirAvec([
        CibleCotisation.ETUDIANT,
        CibleCotisation.VISITEUR,
      ]);

      expect(condition).toContain(' OR ');
    });

    it('situe l’alumni par rapport au mandat en cours', async () => {
      const [condition, parametres] = await ouvrirAvec([
        CibleCotisation.ALUMNI,
      ]);

      expect(condition).toContain('promotion <');
      expect(parametres).toMatchObject({ annee: 2027 });
    });

    it('ignore la cible alumni sans mandat actif', async () => {
      // La notion n'a alors aucun repère : la deviner ferait cotiser des gens
      // au hasard.
      trouverActive.mockResolvedValue(null);
      cotisations.findOne.mockResolvedValue(
        cotisation({ cibles: [CibleCotisation.ALUMNI] }),
      );

      await service.ouvrir('c1');

      expect(constructeur.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('encaisse', () => {
    it('refuse une remise nulle ou négative', async () => {
      await expect(
        service.declarerVersement({ id: 'u1' } as User, { montant: 0 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('enregistre une remise sans destinataire désigné', async () => {
      await expect(
        service.declarerVersement({ id: 'u1' } as User, { montant: 50_000 }),
      ).resolves.toMatchObject({ montant: 50_000, recuPar: null });
    });
  });
  describe('règlement des échéances', () => {
    const tranche = (ordre: number, montant: number, date: string) =>
      ({
        ordre,
        libelle: `Tranche ${ordre}`,
        montant,
        dateLimite: new Date(date),
      }) as TrancheCotisation;

    const participation = (
      surcharge: Partial<ParticipationCotisation> = {},
      surchargeCotisation: Partial<Cotisation> = {},
    ): ParticipationCotisation =>
      ({
        id: 'p1',
        montantDu: 30_000,
        montantRegle: 0,
        statut: StatutParticipation.EN_COURS,
        user: { id: 'u1', firstName: 'Awa' },
        cotisation: cotisation({
          titre: 'Cotisation 2027',
          statut: StatutCotisation.OUVERTE,
          fractionnable: true,
          accepteJustificatif: true,
          dateLimite: new Date('2099-06-30'),
          tranches: [
            tranche(1, 10_000, '2099-01-31'),
            tranche(2, 20_000, '2099-03-31'),
          ],
          ...surchargeCotisation,
        }),
        ...surcharge,
      }) as unknown as ParticipationCotisation;

    const transaction = (surcharge: Partial<Transaction> = {}): Transaction =>
      ({
        reference: 'COT-1',
        montant: 10_417,
        origine: OrigineTransaction.COTISATION,
        ...surcharge,
      }) as Transaction;

    describe('échéances proposées', () => {
      it('propose la prochaine tranche et la totalité, pas la suivante', async () => {
        participations.find.mockResolvedValue([participation()]);

        const [mienne] = await service.mesCotisations('u1');

        expect(mienne.participationId).toBe('p1');
        expect(
          mienne.echeances.map((e) => [e.ordreTranche, e.montant, e.payable]),
        ).toEqual([
          [1, 10_000, true],
          [2, 20_000, false],
          [null, 30_000, true],
        ]);
        expect(mienne.echeances[2].libelle).toBe(LIBELLE_TOTALITE);
      });

      it('compte un règlement en attente comme déjà engagé', async () => {
        participations.find.mockResolvedValue([participation()]);
        reglements.find.mockResolvedValue([
          {
            id: 'r0',
            statut: StatutPaiement.EN_ATTENTE,
            montant: 4_000,
            participation: { id: 'p1' },
          },
        ]);

        const [mienne] = await service.mesCotisations('u1');

        // Il reste 6 000 à engager sur la première tranche : la personne peut
        // continuer, sans attendre la validation du premier versement.
        expect(mienne.echeances[0]).toMatchObject({
          ordreTranche: 1,
          montant: 6_000,
          enAttente: 4_000,
          payable: true,
        });
        expect(mienne.avancement.montantEnAttente).toBe(4_000);
        expect(mienne.reglements).toHaveLength(1);
        expect(mienne.reglements[0]).not.toHaveProperty('participation');
      });

      it('rend le pourcentage réellement réglé de chaque tranche', async () => {
        participations.find.mockResolvedValue([
          participation({ montantRegle: 4_000 }),
        ]);

        const [mienne] = await service.mesCotisations('u1');

        expect(mienne.avancement.tranches[0]).toMatchObject({
          regle: 4_000,
          pourcentage: 40,
        });
        expect(mienne.echeances[0]).toMatchObject({ montant: 6_000 });
      });

      it('ne propose que la totalité sans échéancier fractionné', async () => {
        participations.find.mockResolvedValue([
          participation({}, { fractionnable: false }),
        ]);

        const [mienne] = await service.mesCotisations('u1');

        expect(mienne.echeances.map((e) => e.ordreTranche)).toEqual([null]);
      });
    });

    describe('paiement en ligne', () => {
      const payer = (ordreTranche?: number) =>
        service.payerEcheance({ id: 'u1' }, 'p1', {
          ordreTranche,
          methodePaiement: MethodePaiement.ORANGE_MONEY,
          telephone: '+237699000000',
        });

      const payerMontant = (montant: number) =>
        service.payerEcheance({ id: 'u1' }, 'p1', {
          ordreTranche: 1,
          montant,
          methodePaiement: MethodePaiement.ORANGE_MONEY,
          telephone: '+237699000000',
        });

      beforeEach(() => {
        participations.findOne.mockResolvedValue(participation());
      });

      it('débite les frais en plus, mais ne crédite que l’échéance', async () => {
        await payer(1);

        const ouverte = (
          transactions.ouvrir.mock.calls as unknown[][]
        )[0][0] as {
          montant: number;
          fraisPrestataire: number;
          origine: OrigineTransaction;
        };
        expect(ouverte.origine).toBe(OrigineTransaction.COTISATION);
        expect(ouverte.montant).toBeGreaterThan(10_000);
        expect(ouverte.fraisPrestataire).toBeGreaterThan(0);
        expect(passerelle.initier).toHaveBeenCalledWith(
          expect.objectContaining({ montant: ouverte.montant }),
        );
        expect(reglements.save).toHaveBeenCalledWith(
          expect.objectContaining({
            montant: 10_000,
            ordreTranche: 1,
            mode: ModeReglement.EN_LIGNE,
          }),
        );
      });

      it('refuse une tranche qui n’est pas la prochaine', async () => {
        await expect(payer(2)).rejects.toThrow(ConflictException);
        expect(transactions.ouvrir).not.toHaveBeenCalled();
      });

      it('crédite exactement le montant versé, pas la tranche entière', async () => {
        await payerMontant(5_000);

        expect(reglements.save).toHaveBeenCalledWith(
          expect.objectContaining({ montant: 5_000, ordreTranche: 1 }),
        );
        const ouverte = (
          transactions.ouvrir.mock.calls as unknown[][]
        )[0][0] as { montant: number };
        // Les frais se calculent sur ce qui est versé, pas sur la tranche.
        expect(ouverte.montant).toBeGreaterThan(5_000);
        expect(ouverte.montant).toBeLessThan(6_000);
      });

      it('refuse plus que ce qu’il reste sur la tranche', async () => {
        await expect(payerMontant(10_001)).rejects.toThrow(BadRequestException);
        expect(transactions.ouvrir).not.toHaveBeenCalled();
      });

      it('refuse un montant sous le plancher', async () => {
        await expect(payerMontant(499)).rejects.toThrow(BadRequestException);
      });

      it('laisse lancer un second règlement sur ce qu’il reste', async () => {
        // 4 000 attendent déjà : il en reste 6 000 à engager sur la tranche.
        reglements.find.mockResolvedValue([
          { statut: StatutPaiement.EN_ATTENTE, montant: 4_000 },
        ]);

        await payerMontant(6_000);

        expect(reglements.save).toHaveBeenCalledWith(
          expect.objectContaining({ montant: 6_000 }),
        );
      });

      it('refuse ce qui dépasserait ce qui est déjà engagé', async () => {
        reglements.find.mockResolvedValue([
          { statut: StatutPaiement.EN_ATTENTE, montant: 4_000 },
        ]);

        await expect(payerMontant(6_001)).rejects.toThrow(BadRequestException);
      });

      it('refuse tout quand la tranche est déjà couverte par des attentes', async () => {
        reglements.find.mockResolvedValue([
          { statut: StatutPaiement.EN_ATTENTE, montant: 10_000 },
        ]);

        await expect(payerMontant(1_000)).rejects.toThrow(BadRequestException);
      });

      it('exige le reste exact pour « tout le reste »', async () => {
        await expect(
          service.payerEcheance({ id: 'u1' }, 'p1', {
            montant: 10_000,
            methodePaiement: MethodePaiement.ORANGE_MONEY,
          }),
        ).rejects.toThrow(BadRequestException);

        await service.payerEcheance({ id: 'u1' }, 'p1', {
          montant: 30_000,
          methodePaiement: MethodePaiement.ORANGE_MONEY,
        });

        expect(reglements.save).toHaveBeenCalledWith(
          expect.objectContaining({ montant: 30_000, ordreTranche: null }),
        );
      });

      it('ne laisse pas deux demandes simultanées se partager le même reste', async () => {
        // Chaque demande lit « il reste 10 000 » : sans file, les deux
        // seraient acceptées et la personne verserait le double.
        const enBase: Record<string, unknown>[] = [];
        reglements.save.mockImplementation((r: Record<string, unknown>) => {
          const ligne = { ...r, id: `r${enBase.length + 1}` };
          enBase.push(ligne);
          return Promise.resolve(ligne);
        });
        reglements.find.mockImplementation(() =>
          Promise.resolve(
            enBase.filter((r) => r.statut === StatutPaiement.EN_ATTENTE),
          ),
        );

        const [a, b] = await Promise.allSettled([
          payerMontant(10_000),
          payerMontant(10_000),
        ]);

        // Exactement une demande aboutit : le reste ne se partage pas.
        expect(
          [a.status, b.status].filter((s) => s === 'fulfilled'),
        ).toHaveLength(1);
        expect(
          [a.status, b.status].filter((s) => s === 'rejected'),
        ).toHaveLength(1);
        expect(enBase).toHaveLength(1);
      });

      it('referme tout quand l’opérateur refuse la demande', async () => {
        passerelle.initier.mockResolvedValue({
          reference: 'x',
          referenceExterne: '',
          statut: StatutPaiement.ECHOUE,
          urlRedirection: null,
        });

        await expect(payer()).rejects.toThrow(BadRequestException);
        expect(transactions.abandonner).toHaveBeenCalled();
        expect(reglements.update).toHaveBeenCalledWith('r1', {
          statut: StatutPaiement.ECHOUE,
          urlPaiement: null,
        });
      });

      it('ignore la participation d’autrui', async () => {
        participations.findOne.mockResolvedValue(null);

        await expect(payer()).rejects.toThrow(NotFoundException);
      });
    });

    describe('justificatif', () => {
      it('ouvre une transaction sans frais, rattachée à l’échéance', async () => {
        participations.findOne.mockResolvedValue(participation());

        const prepare = await service.preparerJustificatif(
          { id: 'u1' },
          'p1',
          null,
        );

        expect(prepare.libelle).toBe(`Cotisation 2027 — ${LIBELLE_TOTALITE}`);
        expect(transactions.ouvrir).toHaveBeenCalledWith(
          expect.objectContaining({
            montant: 30_000,
            fraisPrestataire: 0,
            methodePaiement: null,
          }),
        );
      });

      it('refuse une cotisation qui n’accepte pas de justificatif', async () => {
        participations.findOne.mockResolvedValue(
          participation({}, { accepteJustificatif: false }),
        );

        await expect(
          service.preparerJustificatif({ id: 'u1' }, 'p1', null),
        ).rejects.toThrow(ConflictException);
      });
    });

    describe('issue d’un paiement', () => {
      const reglement = (surcharge: Partial<ReglementCotisation> = {}) => ({
        id: 'r1',
        reference: 'COT-1',
        libelle: 'Tranche 1',
        montant: 10_000,
        mode: ModeReglement.EN_LIGNE,
        statut: StatutPaiement.EN_ATTENTE,
        participation: participation(),
        ...surcharge,
      });

      beforeEach(() => {
        participations.findOne.mockResolvedValue({ id: 'p1' });
        participations.findOneOrFail.mockResolvedValue({
          montantDu: 30_000,
          montantRegle: 10_000,
          statut: StatutParticipation.EN_COURS,
        });
      });

      it('crédite le montant de l’échéance, pas le débité', async () => {
        reglements.findOne.mockResolvedValue(reglement());

        await service.traiterIssue(transaction(), StatutPaiement.COMPLETE);

        expect(participations.increment).toHaveBeenCalledWith(
          { id: 'p1' },
          'montantRegle',
          10_000,
        );
        // La notification mène à la page de la cotisation : c'est là que se
        // trouve la facture du règlement.
        expect(notifications.notifier).toHaveBeenCalledWith(
          expect.objectContaining({
            lien: '/mon-espace/cotisations/p1',
            libelleLien: 'Voir ma cotisation et ma facture',
          }),
        );
      });

      it('prévient la trésorerie de ce qui entre, frais du prestataire compris', async () => {
        reglements.findOne.mockResolvedValue(reglement());

        await service.traiterIssue(
          transaction({ montant: 10_417, fraisPrestataire: 313 }),
          StatutPaiement.COMPLETE,
        );

        expect(alertes.encaissement).toHaveBeenCalledWith(
          expect.objectContaining({
            origine: 'cotisation',
            montant: 10_417,
            fraisPrestataire: 313,
          }),
        );
      });

      it('n’alerte pas la trésorerie d’un paiement qui échoue', async () => {
        reglements.findOne.mockResolvedValue(reglement());

        await service.traiterIssue(transaction(), StatutPaiement.ECHOUE);

        expect(alertes.encaissement).not.toHaveBeenCalled();
      });

      it('crédite le montant certifié d’un justificatif', async () => {
        reglements.findOne.mockResolvedValue(
          reglement({ mode: ModeReglement.JUSTIFICATIF }),
        );

        await service.traiterIssue(
          transaction({ montant: 8_000 }),
          StatutPaiement.COMPLETE,
        );

        expect(participations.increment).toHaveBeenCalledWith(
          { id: 'p1' },
          'montantRegle',
          8_000,
        );
      });

      it('clôt le règlement refusé et en donne le motif', async () => {
        reglements.findOne.mockResolvedValue(
          reglement({ mode: ModeReglement.JUSTIFICATIF }),
        );

        await service.traiterIssue(
          transaction(),
          StatutPaiement.ECHOUE,
          'Capture illisible',
        );

        expect(reglements.update).toHaveBeenCalledWith('r1', {
          statut: StatutPaiement.ECHOUE,
          urlPaiement: null,
        });
        expect(participations.increment).not.toHaveBeenCalled();
        const notifie = (
          notifications.notifier.mock.calls as unknown[][]
        )[0][0] as {
          message: string;
        };
        expect(notifie.message).toContain('Capture illisible');
      });

      it('reste compatible avec l’ancienne référence de participation', async () => {
        await service.traiterIssue(
          transaction({ reference: 'p1', montant: 5_000 }),
          StatutPaiement.COMPLETE,
        );

        expect(participations.increment).toHaveBeenCalledWith(
          { id: 'p1' },
          'montantRegle',
          5_000,
        );
      });
    });

    describe('versements libres', () => {
      it('dit la tranche et le pourcentage atteint dans la notification', async () => {
        reglements.findOne.mockResolvedValue({
          id: 'r1',
          reference: 'COT-1',
          libelle: 'Tranche 1',
          ordreTranche: 1,
          montant: 5_000,
          mode: ModeReglement.EN_LIGNE,
          statut: StatutPaiement.EN_ATTENTE,
          participation: participation(),
        });
        participations.findOne.mockResolvedValue({ id: 'p1' });
        participations.findOneOrFail.mockResolvedValue({
          montantDu: 30_000,
          montantRegle: 5_000,
          statut: StatutParticipation.EN_COURS,
        });

        await service.traiterIssue(
          transaction({ montant: 5_200 }),
          StatutPaiement.COMPLETE,
        );

        const notifie = (
          notifications.notifier.mock.calls as unknown[][]
        )[0][0] as { message: string };
        // 5 000 versés sur une tranche de 10 000 : la moitié, dite à la lettre.
        expect(notifie.message).toContain('50 %');
        expect(notifie.message).toContain('Tranche 1');
        expect(notifie.message).toContain('25');
      });

      it('rattache un justificatif au montant déclaré, pas à la tranche entière', async () => {
        participations.findOne.mockResolvedValue(participation());

        await service.preparerJustificatif({ id: 'u1' }, 'p1', 1, 3_000);

        expect(reglements.save).toHaveBeenCalledWith(
          expect.objectContaining({ montant: 3_000, ordreTranche: 1 }),
        );
        expect(transactions.ouvrir).toHaveBeenCalledWith(
          expect.objectContaining({ montant: 3_000, fraisPrestataire: 0 }),
        );
      });

      it('refuse un justificatif déclaré au-delà de ce qui reste', async () => {
        participations.findOne.mockResolvedValue(participation());

        await expect(
          service.preparerJustificatif({ id: 'u1' }, 'p1', 1, 10_001),
        ).rejects.toThrow(BadRequestException);
        expect(transactions.ouvrir).not.toHaveBeenCalled();
      });

      it('chiffre les frais d’un montant libre, par opérateur', () => {
        const frais = service.fraisPour(5_000);

        expect(frais.ORANGE_MONEY.prixBase).toBe(5_000);
        expect(frais.ORANGE_MONEY.montantTtc).toBeGreaterThan(5_000);
        expect(frais.MTN_MOMO.montantTtc).toBeGreaterThanOrEqual(
          frais.ORANGE_MONEY.montantTtc,
        );
      });
    });

    describe('abandon', () => {
      it('ferme le lien chez le prestataire et libère les échéances', async () => {
        reglements.findOne.mockResolvedValue({
          id: 'r1',
          reference: 'COT-1',
          mode: ModeReglement.EN_LIGNE,
          statut: StatutPaiement.EN_ATTENTE,
        });
        transactions.trouver.mockResolvedValue({ referenceExterne: 'ext-1' });

        await service.abandonnerReglement({ id: 'u1' }, 'r1');

        expect(passerelle.expirer).toHaveBeenCalledWith('ext-1');
        expect(transactions.appliquer).toHaveBeenCalledWith(
          'COT-1',
          StatutPaiement.ECHOUE,
        );
      });

      it('refuse d’abandonner un justificatif', async () => {
        reglements.findOne.mockResolvedValue({
          id: 'r1',
          mode: ModeReglement.JUSTIFICATIF,
          statut: StatutPaiement.EN_ATTENTE,
        });

        await expect(
          service.abandonnerReglement({ id: 'u1' }, 'r1'),
        ).rejects.toThrow(ConflictException);
      });
    });

    it('prévient les personnes nouvellement appelées à l’ouverture', async () => {
      cotisations.findOne.mockResolvedValue(
        cotisation({ dateLimite: new Date('2099-06-30') }),
      );
      constructeur.getMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);

      await service.ouvrir('c1');

      expect(notifications.notifierPlusieurs).toHaveBeenCalledWith(
        [{ id: 'u1' }, { id: 'u2' }],
        expect.objectContaining({ lien: '/mon-espace/cotisations' }),
      );
    });
  });
});
