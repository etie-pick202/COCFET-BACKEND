import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { Evenement } from './../src/modules/evenement/entities/evenement.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const GENERATIONS = '/api/v1/generations';

describe('Générations (e2e)', () => {
  let app: INestApplication<App>;
  let generations: Repository<Generation>;
  let evenements: Repository<Evenement>;
  let users: Repository<User>;
  let admin: CompteDeTest;
  let etudiant: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
  };

  const creer = (annee: number, surcharge: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(GENERATIONS)
      .set(admin.entetes)
      .send({ annee, nom: `Promotion ${annee}`, ...surcharge });

  const activer = (id: string) =>
    request(app.getHttpServer())
      .post(`${GENERATIONS}/${id}/activer`)
      .set(admin.entetes);

  const idDe = (reponse: { body: unknown }) =>
    (reponse.body as { id: string }).id;

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

    generations = app.get(getRepositoryToken(Generation));
    evenements = app.get(getRepositoryToken(Evenement));
    users = app.get(getRepositoryToken(User));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await evenements.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);

    admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
    etudiant = await creerCompteAuthentifie(app, { promotion: 2027 });
  });

  afterAll(async () => {
    await evenements.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('thème public', () => {
    it('répond sans jeton, même sans génération active', async () => {
      // Une plateforme fraîchement installée doit pouvoir s'afficher plutôt
      // que rester bloquée sur un écran blanc.
      const reponse = await request(app.getHttpServer())
        .get(`${GENERATIONS}/theme`)
        .expect(200);

      expect(reponse.body).toEqual({
        annee: null,
        nom: null,
        logo: null,
        couleurPrimaire: '#000000',
        couleurSecondaire: '#FFFFFF',
      });
    });

    it('renvoie les couleurs de la génération en cours', async () => {
      const id = idDe(
        await creer(2027, {
          couleurPrimaire: '#1d4ed8',
          couleurSecondaire: '#f8fafc',
        }).expect(201),
      );
      await activer(id).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${GENERATIONS}/theme`)
        .expect(200);

      expect(reponse.body).toMatchObject({
        annee: 2027,
        couleurPrimaire: '#1d4ed8',
      });
    });
  });

  describe('création', () => {
    it('crée une génération inactive', async () => {
      // L'activation bascule toute la plateforme : elle mérite un geste
      // explicite, pas un effet de bord de la création.
      const reponse = await creer(2027).expect(201);

      expect(reponse.body).toMatchObject({ annee: 2027, isActive: false });
    });

    it('refuse une année déjà prise', async () => {
      await creer(2027).expect(201);
      await creer(2027).expect(409);
    });

    it('refuse une couleur qui n’est pas un code hexadécimal', async () => {
      await creer(2027, { couleurPrimaire: 'bleu' }).expect(400);
    });

    it('refuse une année manifestement erronée', async () => {
      await creer(20227).expect(400);
    });

    it('est refusée à un étudiant', async () => {
      await request(app.getHttpServer())
        .post(GENERATIONS)
        .set(etudiant.entetes)
        .send({ annee: 2030, nom: 'Autoproclamée' })
        .expect(403);
    });
  });

  describe('unicité de la génération active', () => {
    it('désactive la précédente en activant la suivante', async () => {
      const premiere = idDe(await creer(2026).expect(201));
      const seconde = idDe(await creer(2027).expect(201));

      await activer(premiere).expect(201);
      await activer(seconde).expect(201);

      await expect(generations.countBy({ isActive: true })).resolves.toBe(1);
      await expect(
        generations.findOne({ where: { id: premiere } }),
      ).resolves.toMatchObject({ isActive: false });
    });

    it('est garantie par la base, pas seulement par le service', async () => {
      // Une tâche, une migration ou une correction en SQL contournerait le
      // code ; jamais l'index partiel unique.
      const id = idDe(await creer(2026).expect(201));
      await activer(id).expect(201);
      const autre = idDe(await creer(2027).expect(201));

      await expect(
        generations.update(autre, { isActive: true }),
      ).rejects.toThrow();
    });

    it('reste sans effet si la génération est déjà active', async () => {
      const id = idDe(await creer(2027).expect(201));

      await activer(id).expect(201);
      await activer(id).expect(201);

      await expect(generations.countBy({ isActive: true })).resolves.toBe(1);
    });
  });

  describe('marquage des finissants', () => {
    it('recalcule le statut à chaque bascule', async () => {
      // isFinissant est calculé, jamais saisi : il conditionne l'appartenance
      // à l'annuaire consulté par les entreprises partenaires.
      const ancien = await creerCompteAuthentifie(app, { promotion: 2026 });

      const g2026 = idDe(await creer(2026).expect(201));
      await activer(g2026).expect(201);

      await expect(
        users.findOne({ where: { id: ancien.user.id } }),
      ).resolves.toMatchObject({ isFinissant: true });
      await expect(
        users.findOne({ where: { id: etudiant.user.id } }),
      ).resolves.toMatchObject({ isFinissant: false });

      const g2027 = idDe(await creer(2027).expect(201));
      await activer(g2027).expect(201);

      // La bascule inverse les deux : l'ancien sort de l'annuaire, le nouveau
      // y entre.
      await expect(
        users.findOne({ where: { id: ancien.user.id } }),
      ).resolves.toMatchObject({ isFinissant: false });
      await expect(
        users.findOne({ where: { id: etudiant.user.id } }),
      ).resolves.toMatchObject({ isFinissant: true });
    });

    it('laisse hors de l’annuaire un compte sans promotion', async () => {
      const visiteur = await creerCompteAuthentifie(app, {
        role: Role.VISITOR,
      });
      const id = idDe(await creer(2027).expect(201));

      await activer(id).expect(201);

      await expect(
        users.findOne({ where: { id: visiteur.user.id } }),
      ).resolves.toMatchObject({ isFinissant: false });
    });
  });

  describe('archivage', () => {
    it('refuse d’archiver la génération en cours', async () => {
      // La plateforme se retrouverait sans thème, sans tarif campus et sans
      // finissants.
      const id = idDe(await creer(2027).expect(201));
      await activer(id).expect(201);

      await request(app.getHttpServer())
        .post(`${GENERATIONS}/${id}/archiver`)
        .set(admin.entetes)
        .expect(409);
    });

    it('fige les statistiques du mandat', async () => {
      const g2026 = idDe(await creer(2026).expect(201));
      await activer(g2026).expect(201);

      const generation = await generations.findOneOrFail({
        where: { id: g2026 },
      });
      await evenements.save(
        evenements.create({
          titre: 'Gala 2026',
          description: 'Soirée du mandat précédent.',
          dateDebut: new Date(Date.now() + 86_400_000),
          lieu: 'Campus',
          generation,
        }),
      );

      const g2027 = idDe(await creer(2027).expect(201));
      await activer(g2027).expect(201);

      const reponse = await request(app.getHttpServer())
        .post(`${GENERATIONS}/${g2026}/archiver`)
        .set(admin.entetes)
        .expect(201);

      const corps = reponse.body as {
        archivedAt: string;
        stats: { totalEvents: number; totalRevenue: number };
      };
      expect(corps.archivedAt).not.toBeNull();
      expect(corps.stats.totalEvents).toBe(1);
      // Aucun paiement abouti : additionner les intentions en attente
      // gonflerait le bilan de sommes jamais encaissées.
      expect(corps.stats.totalRevenue).toBe(0);
    });

    it('ne modifie plus une génération archivée', async () => {
      const id = idDe(await creer(2026).expect(201));
      await request(app.getHttpServer())
        .post(`${GENERATIONS}/${id}/archiver`)
        .set(admin.entetes)
        .expect(201);

      await request(app.getHttpServer())
        .patch(`${GENERATIONS}/${id}`)
        .set(admin.entetes)
        .send({ nom: 'Renommée après coup' })
        .expect(409);

      await activer(id).expect(409);
    });
  });

  describe('suppression', () => {
    it('supprime une génération créée par erreur', async () => {
      const id = idDe(await creer(2099).expect(201));

      await request(app.getHttpServer())
        .delete(`${GENERATIONS}/${id}`)
        .set(admin.entetes)
        .expect(204);

      await expect(generations.countBy({ id })).resolves.toBe(0);
    });

    it('refuse de supprimer la génération en cours', async () => {
      const id = idDe(await creer(2027).expect(201));
      await activer(id).expect(201);

      await request(app.getHttpServer())
        .delete(`${GENERATIONS}/${id}`)
        .set(admin.entetes)
        .expect(409);
    });

    it('refuse de supprimer une archive', async () => {
      // Elle conserve le bilan d'un mandat : c'est de l'histoire, pas un
      // brouillon.
      const id = idDe(await creer(2026).expect(201));
      await request(app.getHttpServer())
        .post(`${GENERATIONS}/${id}/archiver`)
        .set(admin.entetes)
        .expect(201);

      await request(app.getHttpServer())
        .delete(`${GENERATIONS}/${id}`)
        .set(admin.entetes)
        .expect(409);
    });
  });
});
