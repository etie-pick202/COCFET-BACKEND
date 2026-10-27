import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { MembreBureau } from './../src/modules/bureau/entities/membre-bureau.entity';
import { PosteBureau } from './../src/modules/bureau/entities/poste-bureau.entity';
import { Cotisation } from './../src/modules/cotisation/entities/cotisation.entity';
import { ParticipationCotisation } from './../src/modules/cotisation/entities/participation-cotisation.entity';
import { ReglementCotisation } from './../src/modules/cotisation/entities/reglement-cotisation.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { AlerteTresorerieService } from './../src/modules/notification/alerte-tresorerie.service';
import { Notification } from './../src/modules/notification/entities/notification.entity';
import { Transaction } from './../src/modules/paiement/entities/transaction.entity';
import { StatutPaiement } from './../src/modules/paiement/enums/paiement.enum';
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const COTISATIONS = '/api/v1/cotisations';
const WEBHOOK = '/api/v1/webhooks/fapshi';
const SECRET_WEBHOOK = 'secret-de-developpement';
const ANNEE = 2027;

/**
 * Cotiser pour quelqu'un d'autre, de bout en bout : la recherche des personnes
 * appelées à la même cotisation, un règlement offert, un paiement partagé, et
 * ce que chacun voit.
 */
describe('Cotiser pour un autre (e2e)', () => {
  let app: INestApplication<App>;
  let cotisations: Repository<Cotisation>;
  let participations: Repository<ParticipationCotisation>;
  let reglements: Repository<ReglementCotisation>;
  let transactions: Repository<Transaction>;
  let notifications: Repository<Notification>;
  let generations: Repository<Generation>;
  let postes: Repository<PosteBureau>;
  let membres: Repository<MembreBureau>;

  let tresoriere: CompteDeTest;
  let payeur: CompteDeTest;
  let amie: CompteDeTest;
  let ami: CompteDeTest;
  let etudiant: CompteDeTest;
  let cotisationId: string;
  let encaissement: jest.SpyInstance;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBienvenueAuBureau: jest.fn().mockResolvedValue(undefined),
  };

  const participationDe = (compte: CompteDeTest) =>
    participations.findOneOrFail({
      where: {
        cotisation: { id: cotisationId },
        user: { id: compte.user.id },
      },
    });

  const regler = (
    lignes: Record<string, unknown>[],
    qui: CompteDeTest = payeur,
  ) =>
    request(app.getHttpServer())
      .post(`${COTISATIONS}/${cotisationId}/payer-groupe`)
      .set(qui.entetes)
      .send({ lignes });

  const chercher = (q: string, qui: CompteDeTest = payeur) =>
    request(app.getHttpServer())
      .get(`${COTISATIONS}/${cotisationId}/proches`)
      .query({ q })
      .set(qui.entetes);

  const notifierPaiement = (reference: string, statut: StatutPaiement) =>
    request(app.getHttpServer())
      .post(WEBHOOK)
      .set('Content-Type', 'application/json')
      .set('x-wh-secret', SECRET_WEBHOOK)
      .send(
        JSON.stringify({ reference, referenceExterne: 'trx_simule', statut }),
      )
      .expect(200);

  const titresRecus = async (compte: CompteDeTest): Promise<string[]> =>
    (await notifications.find({ where: { user: { id: compte.user.id } } })).map(
      (n) => n.titre,
    );

  const reference = (reponse: { body: unknown }): string =>
    (reponse.body as { reference: string }).reference;

  const purger = async (): Promise<void> => {
    await reglements.createQueryBuilder().delete().execute();
    await participations.createQueryBuilder().delete().execute();
    await cotisations.createQueryBuilder().delete().execute();
    await transactions.createQueryBuilder().delete().execute();
    await notifications.createQueryBuilder().delete().execute();
    await membres.createQueryBuilder().delete().execute();
    await postes.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue(faussaireMail)
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new FiltreExceptionGlobal());
    await app.init();

    cotisations = app.get(getRepositoryToken(Cotisation));
    participations = app.get(getRepositoryToken(ParticipationCotisation));
    reglements = app.get(getRepositoryToken(ReglementCotisation));
    transactions = app.get(getRepositoryToken(Transaction));
    notifications = app.get(getRepositoryToken(Notification));
    generations = app.get(getRepositoryToken(Generation));
    postes = app.get(getRepositoryToken(PosteBureau));
    membres = app.get(getRepositoryToken(MembreBureau));
    encaissement = jest.spyOn(app.get(AlerteTresorerieService), 'encaissement');
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await purger();

    const generation = await generations.save(
      generations.create({ annee: ANNEE, nom: 'ATLAS', isActive: true }),
    );
    tresoriere = await creerCompteAuthentifie(app, {
      role: Role.ADMIN,
      promotion: ANNEE,
    });
    payeur = await creerCompteAuthentifie(app, {
      prenom: 'Étienne',
      nom: 'Mayack',
      promotion: ANNEE,
      isFinissant: true,
    });
    amie = await creerCompteAuthentifie(app, {
      prenom: 'Marie',
      nom: 'Dupont',
      promotion: ANNEE,
      isFinissant: true,
    });
    ami = await creerCompteAuthentifie(app, {
      prenom: 'Paul',
      nom: 'Essomba',
      promotion: ANNEE,
      isFinissant: true,
    });
    // Étudiant d'une autre promotion : jamais appelé à la cotisation des finissants.
    etudiant = await creerCompteAuthentifie(app, {
      prenom: 'Zoé',
      nom: 'Cadette',
      promotion: 2029,
    });

    const poste = await postes.save(
      postes.create({ nom: 'Trésorière', accedeTresorerie: true }),
    );
    await membres.save(
      membres.create({
        generation,
        poste,
        user: { id: tresoriere.user.id } as User,
      }),
    );

    const cree = await request(app.getHttpServer())
      .post(COTISATIONS)
      .set(tresoriere.entetes)
      .send({
        titre: 'Cotisation des finissants',
        montantTotal: 30000,
        cibles: ['FINISSANT'],
        fractionnable: true,
        tranches: [
          {
            ordre: 1,
            libelle: 'Première tranche',
            montant: 10000,
            dateLimite: '2099-01-01T00:00:00.000Z',
          },
          {
            ordre: 2,
            libelle: 'Deuxième tranche',
            montant: 20000,
            dateLimite: '2099-06-01T00:00:00.000Z',
          },
        ],
      })
      .expect(201);
    cotisationId = (cree.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`${COTISATIONS}/${cotisationId}/ouvrir`)
      .set(tresoriere.entetes)
      .expect(201);
  });

  afterAll(async () => {
    await purger();
    await app.close();
  });

  describe('retrouver une personne pour qui cotiser', () => {
    it('propose les personnes de la même cotisation, avec ce qu’on peut régler', async () => {
      const reponse = await chercher('dupont').expect(200);

      const trouves = reponse.body as {
        participationId: string;
        prenom: string;
        emailMasque: string;
        montantRestant: number;
        echeances: { ordreTranche: number | null; payable: boolean }[];
      }[];
      expect(trouves).toHaveLength(1);
      expect(trouves[0]).toMatchObject({
        prenom: 'Marie',
        montantRestant: 30000,
      });
      expect(trouves[0].participationId).toBe((await participationDe(amie)).id);
      expect(trouves[0].emailMasque).toMatch(/^t\*\*\*@/);
      expect(trouves[0].echeances.length).toBeGreaterThan(0);
      expect(JSON.stringify(trouves)).not.toContain(amie.user.email);
    });

    it('ne propose ni soi-même ni quelqu’un qui n’est pas appelé', async () => {
      expect((await chercher('mayack').expect(200)).body).toEqual([]);
      expect((await chercher('cadette').expect(200)).body).toEqual([]);
    });

    it('refuse à qui n’est pas appelé à la cotisation', async () => {
      await chercher('dupont', etudiant).expect(403);
    });

    it('exige trois caractères et une session', async () => {
      await chercher('du').expect(400);
      await request(app.getHttpServer())
        .get(`${COTISATIONS}/${cotisationId}/proches`)
        .query({ q: 'dupont' })
        .expect(401);
    });

    it('écarte ceux qui n’ont plus rien à verser', async () => {
      const participation = await participationDe(amie);
      await participations.update(participation.id, {
        montantRegle: participation.montantDu,
      });

      expect((await chercher('dupont').expect(200)).body).toEqual([]);
    });
  });

  describe('régler pour quelqu’un', () => {
    it('crédite la personne, pas le payeur, une fois le paiement reçu', async () => {
      const part = await participationDe(amie);
      const lance = await regler([
        { participationId: part.id, ordreTranche: 1 },
      ]).expect(201);

      const reglement = await reglements.findOneOrFail({
        where: { participation: { id: part.id } },
        relations: { payeur: true },
      });
      expect(reglement.payeur?.id).toBe(payeur.user.id);
      expect(reglement.groupePaiement).toBeNull();
      // Rien n'est crédité tant que l'opérateur n'a pas confirmé.
      expect((await participationDe(amie)).montantRegle).toBe(0);

      const transaction = await transactions.findOneOrFail({
        where: { reference: reference(lance) },
        relations: { user: true },
      });
      expect(transaction.user?.id).toBe(payeur.user.id);

      await notifierPaiement(reference(lance), StatutPaiement.COMPLETE);

      expect((await participationDe(amie)).montantRegle).toBe(10000);
      expect((await participationDe(payeur)).montantRegle).toBe(0);
    });

    it('prévient les deux et dit à la trésorerie pour qui', async () => {
      const part = await participationDe(amie);
      const lance = await regler([
        { participationId: part.id, ordreTranche: 1 },
      ]).expect(201);

      await notifierPaiement(reference(lance), StatutPaiement.COMPLETE);

      const pourElle = (
        await notifications.find({ where: { user: { id: amie.user.id } } })
      ).map((n) => n.titre);
      expect(
        pourElle.some((t) => t.includes('Étienne Mayack a réglé pour vous')),
      ).toBe(true);
      expect(await titresRecus(payeur)).toContain(
        'Règlement payé pour Marie Dupont',
      );
      expect(encaissement).toHaveBeenCalledWith(
        expect.objectContaining({
          origine: 'cotisation',
          objet: expect.stringContaining('Marie Dupont') as string,
        }),
      );
    });

    it('montre à la personne qui a payé', async () => {
      const part = await participationDe(amie);
      const lance = await regler([{ participationId: part.id }]).expect(201);
      await notifierPaiement(reference(lance), StatutPaiement.COMPLETE);

      const reponse = await request(app.getHttpServer())
        .get(`${COTISATIONS}/participations/${part.id}`)
        .set(amie.entetes)
        .expect(200);

      const regles = (
        reponse.body as { reglements: { payePar: string | null }[] }
      ).reglements;
      expect(regles[0].payePar).toBe('Étienne Mayack');
      // Le compte du payeur n'est pas exposé : seulement son nom.
      expect(JSON.stringify(reponse.body)).not.toContain(payeur.user.email);
    });

    it('refuse une personne qui n’est pas appelée à cette cotisation', async () => {
      // Une autre cotisation, qui appelle les étudiants : Zoé y a une
      // participation, mais pas dans celle des finissants.
      const seconde = await request(app.getHttpServer())
        .post(COTISATIONS)
        .set(tresoriere.entetes)
        .send({
          titre: 'Cotisation des étudiants',
          montantTotal: 5000,
          cibles: ['ETUDIANT'],
          fractionnable: false,
        })
        .expect(201);
      const secondeId = (seconde.body as { id: string }).id;
      await request(app.getHttpServer())
        .post(`${COTISATIONS}/${secondeId}/ouvrir`)
        .set(tresoriere.entetes)
        .expect(201);
      const etrangere = await participations.findOneOrFail({
        where: {
          cotisation: { id: secondeId },
          user: { id: etudiant.user.id },
        },
      });

      await regler([{ participationId: etrangere.id }]).expect(404);
      expect(await reglements.count()).toBe(0);
    });

    it('refuse à qui n’est pas appelé lui-même', async () => {
      const part = await participationDe(amie);

      await regler([{ participationId: part.id }], etudiant).expect(403);
    });

    it('bloque la personne tant qu’un règlement attend, comme pour elle-même', async () => {
      const part = await participationDe(amie);
      await regler([{ participationId: part.id, ordreTranche: 1 }]).expect(201);

      // Marie ne peut pas régler la même tranche en double pendant ce temps :
      // l'échéance est déjà couverte par le règlement qui attend.
      await request(app.getHttpServer())
        .post(`${COTISATIONS}/participations/${part.id}/payer`)
        .set(amie.entetes)
        .send({ ordreTranche: 1 })
        .expect(400);
    });

    it('adresse la facture au payeur, et la refuse à la personne', async () => {
      const part = await participationDe(amie);
      const lance = await regler([{ participationId: part.id }]).expect(201);
      await notifierPaiement(reference(lance), StatutPaiement.COMPLETE);
      const reglement = await reglements.findOneOrFail({
        where: { participation: { id: part.id } },
      });

      await request(app.getHttpServer())
        .post(`/api/v1/documents/facture-cotisation/${reglement.id}`)
        .set(amie.entetes)
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/v1/documents/facture-cotisation/${reglement.id}`)
        .set(payeur.entetes)
        .expect(201);
    });

    it('liste les règlements offerts', async () => {
      const part = await participationDe(amie);
      await regler([{ participationId: part.id }]).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${COTISATIONS}/offertes`)
        .set(payeur.entetes)
        .expect(200);

      expect(reponse.body).toEqual([
        expect.objectContaining({
          cotisation: 'Cotisation des finissants',
          beneficiaire: { prenom: 'Marie', nom: 'Dupont' },
          statut: StatutPaiement.EN_ATTENTE,
        }),
      ]);
      expect(
        (
          await request(app.getHttpServer())
            .get(`${COTISATIONS}/offertes`)
            .set(amie.entetes)
            .expect(200)
        ).body,
      ).toEqual([]);
    });
  });

  describe('payer pour plusieurs en une fois', () => {
    it('règle soi-même et deux proches d’un seul paiement', async () => {
      const lance = await regler([
        { ordreTranche: 1 },
        {
          participationId: (await participationDe(amie)).id,
          ordreTranche: 1,
        },
        {
          participationId: (await participationDe(ami)).id,
          ordreTranche: 1,
        },
      ]).expect(201);

      expect(reference(lance)).toMatch(/^GRP-/);
      expect(await transactions.count()).toBe(1);
      expect(await reglements.count()).toBe(3);

      const transaction = await transactions.findOneOrFail({
        where: { reference: reference(lance) },
      });
      const parts = await reglements.find();
      expect(transaction.montant).toBe(
        parts.reduce((t, r) => t + (r.montantDebite ?? 0), 0),
      );

      await notifierPaiement(reference(lance), StatutPaiement.COMPLETE);

      for (const compte of [payeur, amie, ami]) {
        expect((await participationDe(compte)).montantRegle).toBe(10000);
      }
      expect(await titresRecus(amie)).toEqual(
        expect.arrayContaining([expect.stringContaining('a réglé pour vous')]),
      );
      // Chaque règlement est annoncé pour sa part, pas pour le total.
      expect(encaissement).toHaveBeenCalledTimes(3);
    });

    it('ne crédite personne et ne prévient qu’une fois le payeur quand le paiement échoue', async () => {
      const lance = await regler([
        {},
        { participationId: (await participationDe(amie)).id },
      ]).expect(201);

      await notifierPaiement(reference(lance), StatutPaiement.ECHOUE);

      expect((await participationDe(payeur)).montantRegle).toBe(0);
      expect((await participationDe(amie)).montantRegle).toBe(0);
      expect(await reglements.countBy({ statut: StatutPaiement.ECHOUE })).toBe(
        2,
      );
      expect(
        (await titresRecus(payeur)).filter((t) =>
          t.startsWith('Règlement non abouti'),
        ),
      ).toHaveLength(1);
      // La personne ne savait pas qu'on réglait pour elle.
      expect(await titresRecus(amie)).not.toContain(
        'Règlement non abouti : Cotisation des finissants',
      );
    });

    it('ne garde rien quand une des échéances n’est pas réglable', async () => {
      const part = await participationDe(amie);

      // 999 999 FCFA dépasse ce qu'il reste à verser sur la tranche.
      await regler([
        {},
        { participationId: part.id, ordreTranche: 1, montant: 999999 },
      ]).expect(400);

      expect(await reglements.count()).toBe(0);
      expect(await transactions.count()).toBe(0);
    });

    it('refuse la même personne deux fois, ou plus de cinq lignes', async () => {
      const part = await participationDe(amie);

      await regler([
        { participationId: part.id },
        { participationId: part.id },
      ]).expect(400);
      await regler(
        Array.from({ length: 6 }, () => ({ participationId: part.id })),
      ).expect(400);
      await regler([]).expect(400);
      expect(await reglements.count()).toBe(0);
    });

    it('laisse le payeur abandonner tout le paiement, et pas la personne', async () => {
      const part = await participationDe(amie);
      await regler([{}, { participationId: part.id }]).expect(201);
      const offert = await reglements.findOneOrFail({
        where: { participation: { id: part.id } },
      });

      await request(app.getHttpServer())
        .delete(`${COTISATIONS}/reglements/${offert.id}`)
        .set(amie.entetes)
        .expect(404);
      await request(app.getHttpServer())
        .delete(`${COTISATIONS}/reglements/${offert.id}`)
        .set(payeur.entetes)
        .expect(204);

      // Tout le groupe est refermé : une seule page de paiement.
      expect(await reglements.countBy({ statut: StatutPaiement.ECHOUE })).toBe(
        2,
      );
    });
  });
});
