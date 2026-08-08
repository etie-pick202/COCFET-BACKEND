import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import {
  Produit,
  StatutProduit,
} from './../src/modules/boutique/entities/produit.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const PRODUITS = '/api/v1/produits';
const ANNEE_ACTIVE = 2027;

describe('Boutique (e2e)', () => {
  let app: INestApplication<App>;
  let produits: Repository<Produit>;
  let generations: Repository<Generation>;

  let admin: CompteDeTest;
  let finissant: CompteDeTest;
  let externe: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBillet: jest.fn().mockResolvedValue(undefined),
  };

  const creerProduit = (surcharge: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(PRODUITS)
      .set(admin.entetes)
      .send({
        nom: 'Sweat capuche promo',
        description: 'Sweat brodé aux couleurs de la promotion.',
        prixCampus: 12000,
        prixExterne: 15000,
        stock: 10,
        ...surcharge,
      });

  /** Crée et renvoie l'identifiant. */
  const creerEtRecuperer = async (
    surcharge: Record<string, unknown> = {},
  ): Promise<string> => {
    const reponse = await creerProduit(surcharge).expect(201);
    return (reponse.body as { id: string }).id;
  };

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

    produits = app.get(getRepositoryToken(Produit));
    generations = app.get(getRepositoryToken(Generation));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await produits.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);

    await generations.save(
      generations.create({
        annee: ANNEE_ACTIVE,
        nom: `Promotion ${ANNEE_ACTIVE}`,
        isActive: true,
      }),
    );

    admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
    finissant = await creerCompteAuthentifie(app, { promotion: ANNEE_ACTIVE });
    externe = await creerCompteAuthentifie(app, { role: Role.VISITOR });
  });

  afterAll(async () => {
    await produits.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('catalogue', () => {
    it('expose les produits sans authentification', async () => {
      await creerProduit().expect(201);

      const reponse = await request(app.getHttpServer())
        .get(PRODUITS)
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });

    it('cache les produits retirés au public', async () => {
      const id = await creerEtRecuperer();
      await request(app.getHttpServer())
        .delete(`${PRODUITS}/${id}`)
        .set(admin.entetes)
        .expect(200);

      const reponse = await request(app.getHttpServer())
        .get(PRODUITS)
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(0);
    });

    it('ignore un filtre de statut venant d’un non-administrateur', async () => {
      // Demander explicitement les retirés ne doit pas contourner la règle.
      const id = await creerEtRecuperer();
      await request(app.getHttpServer())
        .delete(`${PRODUITS}/${id}`)
        .set(admin.entetes)
        .expect(200);

      const reponse = await request(app.getHttpServer())
        .get(PRODUITS)
        .query({ statut: StatutProduit.RETIRE })
        .set(finissant.entetes)
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(0);
    });

    it('répond 404 sur un produit retiré, comme sur un identifiant inconnu', async () => {
      const id = await creerEtRecuperer();
      await request(app.getHttpServer())
        .delete(`${PRODUITS}/${id}`)
        .set(admin.entetes)
        .expect(200);

      await request(app.getHttpServer())
        .get(`${PRODUITS}/${id}`)
        .set(finissant.entetes)
        .expect(404);
    });

    it('refuse la création à un étudiant', async () => {
      await request(app.getHttpServer())
        .post(PRODUITS)
        .set(finissant.entetes)
        .send({
          nom: 'Article sauvage',
          description: 'Sans autorisation du bureau.',
        })
        .expect(403);
    });
  });

  describe('tarif applicable', () => {
    it('applique le tarif campus à un finissant', async () => {
      const id = await creerEtRecuperer();

      const reponse = await request(app.getHttpServer())
        .get(`${PRODUITS}/${id}`)
        .set(finissant.entetes)
        .expect(200);

      expect(reponse.body).toMatchObject({
        prixApplicable: 12000,
        tarifCampus: true,
      });
    });

    it('applique le tarif externe à un visiteur', async () => {
      const id = await creerEtRecuperer();

      const reponse = await request(app.getHttpServer())
        .get(`${PRODUITS}/${id}`)
        .set(externe.entetes)
        .expect(200);

      expect(reponse.body).toMatchObject({
        prixApplicable: 15000,
        tarifCampus: false,
      });
    });

    it('applique le tarif externe à un visiteur non connecté', async () => {
      const id = await creerEtRecuperer();

      const reponse = await request(app.getHttpServer())
        .get(`${PRODUITS}/${id}`)
        .expect(200);

      expect(reponse.body).toMatchObject({ prixApplicable: 15000 });
    });
  });

  describe('stock', () => {
    it('crée en rupture un produit sans stock', async () => {
      // Annoncer « disponible » un article que personne ne peut recevoir
      // déplacerait la déception du catalogue à la commande.
      const reponse = await creerProduit({ stock: 0 }).expect(201);

      expect(reponse.body).toMatchObject({ statut: StatutProduit.RUPTURE });
    });

    it('bascule en rupture quand le stock atteint zéro', async () => {
      const id = await creerEtRecuperer({ stock: 3 });

      const reponse = await request(app.getHttpServer())
        .patch(`${PRODUITS}/${id}/stock`)
        .set(admin.entetes)
        .send({ quantite: -3 })
        .expect(200);

      expect(reponse.body).toMatchObject({
        stock: 0,
        statut: StatutProduit.RUPTURE,
      });
    });

    it('remet en vente au réapprovisionnement', async () => {
      const id = await creerEtRecuperer({ stock: 0 });

      const reponse = await request(app.getHttpServer())
        .patch(`${PRODUITS}/${id}/stock`)
        .set(admin.entetes)
        .send({ quantite: 5 })
        .expect(200);

      expect(reponse.body).toMatchObject({
        stock: 5,
        statut: StatutProduit.DISPONIBLE,
      });
    });

    it('refuse une correction qui rendrait le stock négatif', async () => {
      const id = await creerEtRecuperer({ stock: 2 });

      await request(app.getHttpServer())
        .patch(`${PRODUITS}/${id}/stock`)
        .set(admin.entetes)
        .send({ quantite: -5 })
        .expect(400);

      await expect(produits.findOneByOrFail({ id })).resolves.toMatchObject({
        stock: 2,
      });
    });

    it('ne laisse pas deux corrections simultanées passer sous zéro', async () => {
      // Le cœur du sujet : deux retraits de 2 sur un stock de 3. Lire puis
      // écrire les laisserait passer tous les deux.
      const id = await creerEtRecuperer({ stock: 3 });

      const retirer = () =>
        request(app.getHttpServer())
          .patch(`${PRODUITS}/${id}/stock`)
          .set(admin.entetes)
          .send({ quantite: -2 });

      const reponses = await Promise.all([retirer(), retirer()]);
      const acceptees = reponses.filter((r) => r.status === 200);

      expect(acceptees).toHaveLength(1);
      await expect(produits.findOneByOrFail({ id })).resolves.toMatchObject({
        stock: 1,
      });
    });

    it('refuse un stock envoyé sur la route de modification', async () => {
      const id = await creerEtRecuperer({ stock: 5 });

      await request(app.getHttpServer())
        .patch(`${PRODUITS}/${id}`)
        .set(admin.entetes)
        .send({ stock: 999 })
        .expect(400);

      await expect(produits.findOneByOrFail({ id })).resolves.toMatchObject({
        stock: 5,
      });
    });

    it('laisse une précommande commandable sans stock', async () => {
      const id = await creerEtRecuperer({
        stock: 0,
        datePrecommande: new Date(Date.now() + 86_400_000).toISOString(),
      });

      const reponse = await request(app.getHttpServer())
        .get(`${PRODUITS}/${id}`)
        .set(finissant.entetes)
        .expect(200);

      expect(reponse.body).toMatchObject({
        statut: StatutProduit.PRECOMMANDE,
        commandable: true,
      });
    });
  });
});
