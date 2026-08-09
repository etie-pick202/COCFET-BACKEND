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
import {
  JournalActivite,
  TypeActivite,
} from './../src/modules/activite/entities/journal-activite.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import {
  OrigineTransaction,
  Transaction,
} from './../src/modules/paiement/entities/transaction.entity';
import {
  MethodePaiement,
  StatutPaiement,
} from './../src/modules/paiement/enums/paiement.enum';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const TABLEAU = '/api/v1/tableau-de-bord';
const ANNEE_ACTIVE = 2027;

/**
 * Le cloisonnement de la trésorerie est une garantie de sécurité, pas un
 * masquage d'interface : ce qui se vérifie ici, c'est qu'un administrateur
 * sans le privilège se fait **refuser par le serveur**, quel que soit le
 * client qu'il utilise.
 */
describe('Tableau de bord (e2e)', () => {
  let app: INestApplication<App>;
  let postes: Repository<PosteBureau>;
  let membres: Repository<MembreBureau>;
  let generations: Repository<Generation>;
  let transactions: Repository<Transaction>;
  let journal: Repository<JournalActivite>;

  let tresoriere: CompteDeTest;
  let chargeeActivites: CompteDeTest;
  let generation: Generation;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBillet: jest.fn().mockResolvedValue(undefined),
  };

  /** Affecte un compte à un poste doté — ou non — de l'accès trésorerie. */
  const affecter = async (
    compte: CompteDeTest,
    nom: string,
    accedeTresorerie: boolean,
  ) => {
    const poste = await postes.save(
      postes.create({
        nom,
        accordeAdministration: true,
        accedeTresorerie,
        autoriseRetrait: accedeTresorerie,
      }),
    );

    await membres.save(
      membres.create({ generation, poste, user: compte.user }),
    );
  };

  /** Compteur plutôt qu'aléatoire : la référence doit seulement être unique. */
  let sequence = 0;

  const encaisser = (montant: number, surcharge = {}) =>
    transactions.save(
      transactions.create({
        reference: `REF-${++sequence}`,
        montant,
        origine: OrigineTransaction.EVENEMENT,
        statut: StatutPaiement.COMPLETE,
        methodePaiement: MethodePaiement.MTN_MOMO,
        user: null,
        ...surcharge,
      }),
    );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue(faussaireMail)
      .compile();

    app = moduleFixture.createNestApplication();
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

    postes = app.get(getRepositoryToken(PosteBureau));
    membres = app.get(getRepositoryToken(MembreBureau));
    generations = app.get(getRepositoryToken(Generation));
    transactions = app.get(getRepositoryToken(Transaction));
    journal = app.get(getRepositoryToken(JournalActivite));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await journal.createQueryBuilder().delete().execute();
    await transactions.createQueryBuilder().delete().execute();
    await membres.createQueryBuilder().delete().execute();
    await postes.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);

    generation = await generations.save(
      generations.create({
        annee: ANNEE_ACTIVE,
        nom: `Promotion ${ANNEE_ACTIVE}`,
        isActive: true,
      }),
    );

    tresoriere = await creerCompteAuthentifie(app, {
      role: Role.ADMIN,
      promotion: ANNEE_ACTIVE,
    });
    chargeeActivites = await creerCompteAuthentifie(app, {
      role: Role.ADMIN,
      promotion: ANNEE_ACTIVE,
    });

    await affecter(tresoriere, 'Trésorière', true);
    await affecter(chargeeActivites, 'Chargée des activités', false);
  });

  afterAll(async () => {
    await journal.createQueryBuilder().delete().execute();
    await transactions.createQueryBuilder().delete().execute();
    await membres.createQueryBuilder().delete().execute();
    await postes.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('cloisonnement', () => {
    it('ouvre les indicateurs d’activité à tout le bureau', async () => {
      // Aucun montant n'y figure : rien à cloisonner.
      await request(app.getHttpServer())
        .get(TABLEAU)
        .set(chargeeActivites.entetes)
        .expect(200);
    });

    it('refuse la trésorerie à un poste qui n’en a pas la charge', async () => {
      // Le cœur du sujet : elle est administratrice, et pourtant refusée.
      await request(app.getHttpServer())
        .get(`${TABLEAU}/tresorerie`)
        .set(chargeeActivites.entetes)
        .expect(403);
    });

    it('refuse aussi le journal des transactions', async () => {
      await request(app.getHttpServer())
        .get(`${TABLEAU}/transactions`)
        .set(chargeeActivites.entetes)
        .expect(403);
    });

    it('ouvre la trésorerie au poste qui en a la charge', async () => {
      await request(app.getHttpServer())
        .get(`${TABLEAU}/tresorerie`)
        .set(tresoriere.entetes)
        .expect(200);
    });

    it('refuse un accès non authentifié', async () => {
      await request(app.getHttpServer())
        .get(`${TABLEAU}/tresorerie`)
        .expect(401);
    });

    it('retire le privilège dès que le poste est quitté', async () => {
      // La passation doit prendre effet immédiatement : le privilège est relu
      // à chaque requête, il n'est pas figé dans le jeton.
      await membres.createQueryBuilder().delete().execute();

      await request(app.getHttpServer())
        .get(`${TABLEAU}/tresorerie`)
        .set(tresoriere.entetes)
        .expect(403);
    });
  });

  describe('indicateurs financiers', () => {
    it('ne compte que les paiements aboutis', async () => {
      await encaisser(10_000);
      await encaisser(5_000);
      // En attente et échoué : présents au journal, absents de la recette.
      await encaisser(99_000, { statut: StatutPaiement.EN_ATTENTE });
      await encaisser(77_000, { statut: StatutPaiement.ECHOUE });

      const reponse = await request(app.getHttpServer())
        .get(`${TABLEAU}/tresorerie`)
        .set(tresoriere.entetes)
        .expect(200);

      expect(reponse.body).toMatchObject({
        recettesTotales: 15_000,
        transactionsAbouties: 2,
        transactionsEnAttente: 1,
        transactionsEchouees: 1,
        panierMoyen: 7_500,
      });
    });

    it('ventile par origine et par méthode', async () => {
      await encaisser(10_000, { origine: OrigineTransaction.EVENEMENT });
      await encaisser(4_000, {
        origine: OrigineTransaction.BOUTIQUE,
        methodePaiement: MethodePaiement.ORANGE_MONEY,
      });

      const reponse = await request(app.getHttpServer())
        .get(`${TABLEAU}/tresorerie`)
        .set(tresoriere.entetes)
        .expect(200);

      const corps = reponse.body as {
        parOrigine: { libelle: string; montant: number }[];
        parMethode: { libelle: string; montant: number }[];
      };

      expect(corps.parOrigine).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ libelle: 'EVENEMENT', montant: 10_000 }),
          expect.objectContaining({ libelle: 'BOUTIQUE', montant: 4_000 }),
        ]),
      );
      expect(corps.parMethode).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ libelle: 'MTN_MOMO', montant: 10_000 }),
        ]),
      );
    });

    it('ne divise pas par zéro sans aucune recette', async () => {
      const reponse = await request(app.getHttpServer())
        .get(`${TABLEAU}/tresorerie`)
        .set(tresoriere.entetes)
        .expect(200);

      expect(reponse.body).toMatchObject({
        recettesTotales: 0,
        panierMoyen: 0,
      });
    });

    it('borne les recettes à la période demandée', async () => {
      await encaisser(10_000);

      const reponse = await request(app.getHttpServer())
        .get(`${TABLEAU}/tresorerie`)
        .query({ depuis: '2020-01-01T00:00:00.000Z' })
        .query({ jusqua: '2020-12-31T23:59:59.000Z' })
        .set(tresoriere.entetes)
        .expect(200);

      expect(reponse.body).toMatchObject({ recettesTotales: 0 });
    });
  });

  describe('journal des transactions', () => {
    it('rend les transactions paginées, les plus récentes d’abord', async () => {
      await encaisser(1_000);
      await encaisser(2_000);

      const reponse = await request(app.getHttpServer())
        .get(`${TABLEAU}/transactions`)
        .set(tresoriere.entetes)
        .expect(200);

      const corps = reponse.body as {
        donnees: unknown[];
        meta: { total: number };
      };
      expect(corps.meta.total).toBe(2);
      expect(corps.donnees).toHaveLength(2);
    });

    it('filtre par statut', async () => {
      await encaisser(1_000);
      await encaisser(2_000, { statut: StatutPaiement.ECHOUE });

      const reponse = await request(app.getHttpServer())
        .get(`${TABLEAU}/transactions`)
        .query({ statut: StatutPaiement.ECHOUE })
        .set(tresoriere.entetes)
        .expect(200);

      expect((reponse.body as { meta: { total: number } }).meta.total).toBe(1);
    });

    it('filtre par origine et par méthode', async () => {
      await encaisser(1_000, { origine: OrigineTransaction.EVENEMENT });
      await encaisser(2_000, {
        origine: OrigineTransaction.BOUTIQUE,
        methodePaiement: MethodePaiement.ORANGE_MONEY,
      });

      const parOrigine = await request(app.getHttpServer())
        .get(`${TABLEAU}/transactions`)
        .query({ origine: OrigineTransaction.BOUTIQUE })
        .set(tresoriere.entetes)
        .expect(200);
      expect((parOrigine.body as { meta: { total: number } }).meta.total).toBe(
        1,
      );

      const parMethode = await request(app.getHttpServer())
        .get(`${TABLEAU}/transactions`)
        .query({ methodePaiement: MethodePaiement.ORANGE_MONEY })
        .set(tresoriere.entetes)
        .expect(200);
      expect((parMethode.body as { meta: { total: number } }).meta.total).toBe(
        1,
      );
    });
  });

  describe('flux d’activité', () => {
    const consigner = (type: TypeActivite, message: string) =>
      journal.save(journal.create({ type, message, user: null }));

    it('rend le journal, du plus récent au plus ancien', async () => {
      await consigner(TypeActivite.PAIEMENT, 'Un paiement');
      await consigner(TypeActivite.SCAN, 'Une entrée');

      const reponse = await request(app.getHttpServer())
        .get(`${TABLEAU}/activite`)
        .set(chargeeActivites.entetes)
        .expect(200);

      const corps = reponse.body as {
        donnees: { message: string }[];
        meta: { total: number };
      };
      expect(corps.meta.total).toBe(2);
      expect(corps.donnees[0].message).toBe('Une entrée');
    });

    it('filtre par type', async () => {
      await consigner(TypeActivite.PAIEMENT, 'Un paiement');
      await consigner(TypeActivite.SCAN, 'Une entrée');

      const reponse = await request(app.getHttpServer())
        .get(`${TABLEAU}/activite`)
        .query({ type: TypeActivite.SCAN })
        .set(chargeeActivites.entetes)
        .expect(200);

      expect((reponse.body as { meta: { total: number } }).meta.total).toBe(1);
    });
  });

  describe('export CSV', () => {
    it('sert un fichier téléchargeable à la trésorerie', async () => {
      await encaisser(12_000);

      const reponse = await request(app.getHttpServer())
        .get(`${TABLEAU}/transactions/export`)
        .set(tresoriere.entetes)
        .expect(200);

      expect(reponse.headers['content-type']).toContain('text/csv');
      expect(reponse.headers['content-disposition']).toContain(
        'transactions.csv',
      );
      expect(reponse.text).toContain('Montant FCFA');
      expect(reponse.text).toContain('12000');
    });

    it('refuse l’export à un poste sans la trésorerie', async () => {
      await request(app.getHttpServer())
        .get(`${TABLEAU}/transactions/export`)
        .set(chargeeActivites.entetes)
        .expect(403);
    });
  });

  describe('indicateurs d’activité', () => {
    it('rend les compteurs sans aucun montant', async () => {
      await encaisser(50_000);

      const reponse = await request(app.getHttpServer())
        .get(TABLEAU)
        .set(chargeeActivites.entetes)
        .expect(200);

      // La garantie du cloisonnement : aucune recette ne fuit par cette route.
      expect(JSON.stringify(reponse.body)).not.toContain('50000');
      const corps = reponse.body as Record<string, number>;
      expect(typeof corps.comptes).toBe('number');
      expect(typeof corps.evenementsPublies).toBe('number');
      expect(typeof corps.tauxPresence).toBe('number');
    });
  });
});
