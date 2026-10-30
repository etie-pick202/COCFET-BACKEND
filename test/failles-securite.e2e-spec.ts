import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { MembreBureau } from './../src/modules/bureau/entities/membre-bureau.entity';
import { PosteBureau } from './../src/modules/bureau/entities/poste-bureau.entity';
import { StockageLocal } from './../src/modules/file/adaptateurs/stockage-local';
import { STOCKAGE } from './../src/modules/file/ports/stockage';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const ENVOI = '/api/v1/fichiers';
const URL_SIGNEE = '/api/v1/fichiers/url-signee';
const MOI = '/api/v1/utilisateurs/moi';

/**
 * Les failles relevées à l'audit de sécurité, rejouées de bout en bout pour
 * qu'elles ne reviennent pas :
 *
 * 1. un compte présentait comme sa photo le fichier d'un autre, puis le
 *    faisait effacer en changeant de photo ;
 * 2. tout administrateur pouvait nommer des administrateurs et se créer un
 *    poste doté de la trésorerie ;
 * 3. tout compte connecté obtenait une URL de lecture pour n'importe quelle
 *    clé, CV et justificatifs compris ;
 * 5. la recherche de personnes comparait l'adresse par morceaux, ce qui
 *    permettait de la reconstituer.
 */
describe('Failles de sécurité corrigées (e2e)', () => {
  let app: INestApplication<App>;
  let stockage: StockageLocal;
  let postes: Repository<PosteBureau>;
  let membres: Repository<MembreBureau>;
  let generations: Repository<Generation>;

  const racine = join(tmpdir(), `cocfet-failles-${randomUUID()}`);

  const configStockage = {
    get: (cle: string, defaut?: string) =>
      ({
        STOCKAGE_LOCAL_DIR: racine,
        PORT: '3000',
        API_PREFIX: 'api/v1',
      })[cle] ?? defaut,
    getOrThrow: () => 'secret-de-signature-des-fichiers',
  } as unknown as ConfigService;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    envoyerBienvenueAuBureau: jest.fn().mockResolvedValue(undefined),
  };

  /** En-tête PNG réel, suivi d'un remplissage. */
  const png = () => {
    const b = Buffer.alloc(512);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
    return b;
  };
  const pdf = () => Buffer.from('%PDF-1.4\n' + 'x'.repeat(200));

  const deposer = async (
    compte: CompteDeTest,
    usage: string,
    contenu = png(),
    nom = 'photo.png',
  ): Promise<string> => {
    const reponse = await request(app.getHttpServer())
      .post(ENVOI)
      .set(compte.entetes)
      .field('usage', usage)
      .attach('fichier', contenu, nom)
      .expect(201);
    return (reponse.body as { cle: string }).cle;
  };

  const existe = (cle: string) =>
    stockage.telecharger(cle).then(
      () => true,
      () => false,
    );

  const viderBureau = async () => {
    await membres.createQueryBuilder().delete().execute();
    await postes.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
  };

  beforeAll(async () => {
    stockage = new StockageLocal(configStockage);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(STOCKAGE)
      .useValue(stockage)
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
  });

  beforeEach(async () => {
    await viderBureau();
    await purgerUtilisateurs(app);
  });

  afterAll(async () => {
    await viderBureau();
    await purgerUtilisateurs(app);
    await app.close();
    await rm(racine, { recursive: true, force: true });
  });

  describe('1. fichiers personnels', () => {
    it('inscrit l’auteur dans la clé d’un fichier personnel', async () => {
      const etudiant = await creerCompteAuthentifie(app);

      const cle = await deposer(etudiant, 'avatar');

      expect(cle.startsWith(`avatars/${etudiant.user.id}_`)).toBe(true);
    });

    it('refuse de prendre pour photo le fichier d’un autre, qui survit', async () => {
      const admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
      const victime = await creerCompteAuthentifie(app);
      const attaquant = await creerCompteAuthentifie(app);
      const logo = await deposer(admin, 'logo');
      const photoVictime = await deposer(victime, 'avatar');

      for (const cle of [logo, photoVictime]) {
        await request(app.getHttpServer())
          .patch(MOI)
          .set(attaquant.entetes)
          .send({ avatar: cle })
          .expect(400);
      }

      // Changer ensuite de photo n'efface que ce qui lui appartient.
      const sienne = await deposer(attaquant, 'avatar');
      await request(app.getHttpServer())
        .patch(MOI)
        .set(attaquant.entetes)
        .send({ avatar: sienne })
        .expect(200);
      await request(app.getHttpServer())
        .patch(MOI)
        .set(attaquant.entetes)
        .send({ avatar: await deposer(attaquant, 'avatar') })
        .expect(200);

      expect(await existe(sienne)).toBe(false);
      expect(await existe(logo)).toBe(true);
      expect(await existe(photoVictime)).toBe(true);
    });

    it('accepte de renvoyer la photo déjà en place', async () => {
      const etudiant = await creerCompteAuthentifie(app);
      const cle = await deposer(etudiant, 'avatar');
      await request(app.getHttpServer())
        .patch(MOI)
        .set(etudiant.entetes)
        .send({ avatar: cle })
        .expect(200);

      await request(app.getHttpServer())
        .patch(MOI)
        .set(etudiant.entetes)
        .send({ prenom: 'Awa', avatar: cle })
        .expect(200);
    });
  });

  describe('3. URL de lecture', () => {
    it('ne livre un CV qu’à son auteur et au bureau', async () => {
      const auteur = await creerCompteAuthentifie(app);
      const curieux = await creerCompteAuthentifie(app);
      const admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
      const cv = await deposer(auteur, 'cv', pdf(), 'cv.pdf');

      const lire = (compte: CompteDeTest) =>
        request(app.getHttpServer())
          .get(URL_SIGNEE)
          .query({ cle: cv })
          .set(compte.entetes);

      await lire(auteur).expect(200);
      await lire(admin).expect(200);
      await lire(curieux).expect(404);
    });

    it('livre les photos de profil à tout membre connecté, pas aux anonymes', async () => {
      const auteur = await creerCompteAuthentifie(app);
      const autre = await creerCompteAuthentifie(app, { role: Role.VISITOR });
      const photo = await deposer(auteur, 'avatar');

      await request(app.getHttpServer())
        .get(URL_SIGNEE)
        .query({ cle: photo })
        .set(autre.entetes)
        .expect(200);
      await request(app.getHttpServer())
        .get(URL_SIGNEE)
        .query({ cle: photo })
        .expect(404);
    });
  });

  describe('2. gestion des accès', () => {
    /** Un mandat actif où `compte` occupe un poste aux droits choisis. */
    const sieger = async (
      compte: CompteDeTest,
      droits: Partial<PosteBureau>,
    ) => {
      const generation = await generations.save(
        generations.create({ annee: 2027, nom: 'ATLAS', isActive: true }),
      );
      const poste = await postes.save(
        postes.create({ nom: 'Président(e)', ...droits }),
      );
      await membres.save(
        membres.create({ generation, poste, user: compte.user }),
      );
    };

    it('refuse à un administrateur ordinaire de nommer un administrateur', async () => {
      const admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
      const complice = await creerCompteAuthentifie(app);

      await request(app.getHttpServer())
        .patch(`/api/v1/utilisateurs/${complice.user.id}`)
        .set(admin.entetes)
        .send({ role: Role.ADMIN })
        .expect(403);
    });

    it('refuse à un administrateur ordinaire de se créer un poste de trésorerie', async () => {
      const admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
      await sieger(admin, { accedeTresorerie: false });

      await request(app.getHttpServer())
        .post('/api/v1/bureau/postes')
        .set(admin.entetes)
        .send({ nom: 'Caisse', accedeTresorerie: true })
        .expect(403);
    });

    it('laisse les autres corrections de compte à toute l’administration', async () => {
      const admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
      const visiteur = await creerCompteAuthentifie(app, {
        role: Role.VISITOR,
      });

      await request(app.getHttpServer())
        .patch(`/api/v1/utilisateurs/${visiteur.user.id}`)
        .set(admin.entetes)
        .send({ role: Role.STUDENT, promotion: 2027 })
        .expect(200);
    });

    it('ouvre ces gestes au poste qui gère les accès', async () => {
      const president = await creerCompteAuthentifie(app, {
        role: Role.ADMIN,
      });
      const recrue = await creerCompteAuthentifie(app);
      await sieger(president, { gereAcces: true });

      await request(app.getHttpServer())
        .patch(`/api/v1/utilisateurs/${recrue.user.id}`)
        .set(president.entetes)
        .send({ role: Role.ADMIN })
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/v1/bureau/postes')
        .set(president.entetes)
        .send({ nom: 'Trésorerie', accedeTresorerie: true })
        .expect(201);
    });
  });

  describe('5. recherche de personnes', () => {
    it('ne retrouve plus quelqu’un par un morceau de son adresse', async () => {
      const chercheur = await creerCompteAuthentifie(app);
      const cible = await creerCompteAuthentifie(app, {
        prenom: 'Zebulon',
        nom: 'Quidam',
      });
      const fragment = cible.user.email.slice(0, 6);

      const parFragment = await request(app.getHttpServer())
        .get('/api/v1/utilisateurs/recherche')
        .query({ q: fragment })
        .set(chercheur.entetes)
        .expect(200);
      const parAdresse = await request(app.getHttpServer())
        .get('/api/v1/utilisateurs/recherche')
        .query({ q: cible.user.email })
        .set(chercheur.entetes)
        .expect(200);

      const ids = (r: { body: unknown }) =>
        (r.body as { id: string }[]).map((p) => p.id);
      expect(ids(parFragment)).not.toContain(cible.user.id);
      expect(ids(parAdresse)).toContain(cible.user.id);
    });
  });
});
