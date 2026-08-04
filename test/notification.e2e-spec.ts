import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { MailService } from './../src/modules/mail/mail.service';
import {
  Notification,
  TypeNotification,
} from './../src/modules/notification/entities/notification.entity';
import { PreferenceNotification } from './../src/modules/notification/entities/preference-notification.entity';
import { NotificationService } from './../src/modules/notification/notification.service';
import { User } from './../src/modules/user/entities/user.entity';
import { PurgeComptesService } from './../src/modules/user/purge-comptes.service';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

describe('Notifications (e2e)', () => {
  let app: INestApplication<App>;
  let service: NotificationService;
  let notifications: Repository<Notification>;
  let preferences: Repository<PreferenceNotification>;
  let users: Repository<User>;
  let alice: CompteDeTest;
  let bob: CompteDeTest;
  let admin: CompteDeTest;

  const mailsEnvoyes: { to: string; titre: string }[] = [];

  const faussaireMail = {
    envoyerNotification: jest.fn((to: string, _p: string, titre: string) => {
      mailsEnvoyes.push({ to, titre });
      return Promise.resolve();
    }),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
  };

  const url = (chemin = '') => `/api/v1/notifications${chemin}`;
  const DIFFUSER = '/diffuser';
  const PREFERENCES = '/preferences';

  const creerPour = (compte: CompteDeTest, surcharge = {}) =>
    service.notifier({
      destinataire: compte.user,
      type: TypeNotification.EVENEMENT,
      titre: 'Gala des finissants',
      message: 'Les inscriptions sont ouvertes.',
      ...surcharge,
    });

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

    service = app.get(NotificationService);
    notifications = app.get(getRepositoryToken(Notification));
    preferences = app.get(getRepositoryToken(PreferenceNotification));
    users = app.get(getRepositoryToken(User));
  });

  beforeEach(async () => {
    mailsEnvoyes.length = 0;
    jest.clearAllMocks();
    await notifications.createQueryBuilder().delete().execute();
    await preferences.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);

    alice = await creerCompteAuthentifie(app, { prenom: 'Alice' });
    bob = await creerCompteAuthentifie(app, { prenom: 'Bob' });
    admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
  });

  afterAll(async () => {
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('cloisonnement entre utilisateurs', () => {
    it('ne montre à chacun que ses propres notifications', async () => {
      await creerPour(alice);
      await creerPour(bob);

      const reponse = await request(app.getHttpServer())
        .get(url())
        .set(alice.entetes)
        .expect(200);

      const corps = reponse.body as { donnees: unknown[]; meta: unknown };
      expect(corps.donnees).toHaveLength(1);
    });

    it('refuse de marquer comme lue la notification d’autrui', async () => {
      // L'identifiant est un UUID, donc difficile à deviner — mais il circule
      // dans les réponses d'API. Le filtrage doit porter sur le porteur du
      // jeton, pas sur la seule connaissance de l'identifiant.
      const aBob = await creerPour(bob);

      await request(app.getHttpServer())
        .patch(url(`/${aBob!.id}/lu`))
        .set(alice.entetes)
        .expect(404);

      await expect(
        notifications.findOne({ where: { id: aBob!.id } }),
      ).resolves.toMatchObject({ isRead: false });
    });

    it('refuse de supprimer la notification d’autrui', async () => {
      const aBob = await creerPour(bob);

      await request(app.getHttpServer())
        .delete(url(`/${aBob!.id}`))
        .set(alice.entetes)
        .expect(404);

      await expect(notifications.countBy({ id: aBob!.id })).resolves.toBe(1);
    });

    it('exige un jeton', async () => {
      await request(app.getHttpServer()).get(url()).expect(401);
    });
  });

  describe('lecture et filtres', () => {
    it('compte les non lues', async () => {
      await creerPour(alice);
      await creerPour(alice);

      const reponse = await request(app.getHttpServer())
        .get(url('/non-lues/compte'))
        .set(alice.entetes)
        .expect(200);

      expect(reponse.body).toEqual({ nonLues: 2 });
    });

    it('filtre sur les non lues', async () => {
      const lue = await creerPour(alice);
      await creerPour(alice);
      await notifications.update(lue!.id, { isRead: true });

      const reponse = await request(app.getHttpServer())
        .get(url())
        .query({ nonLues: 'true' })
        .set(alice.entetes)
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });

    it('traite « nonLues=false » comme un vrai faux', async () => {
      // Un paramètre de requête arrive en chaîne : sans transformation,
      // « false » serait vrai puisque toute chaîne non vide l'est.
      const lue = await creerPour(alice);
      await notifications.update(lue!.id, { isRead: true });

      const reponse = await request(app.getHttpServer())
        .get(url())
        .query({ nonLues: 'false' })
        .set(alice.entetes)
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });

    it('filtre par type', async () => {
      await creerPour(alice, { type: TypeNotification.PAIEMENT });
      await creerPour(alice, { type: TypeNotification.ARTICLE });

      const reponse = await request(app.getHttpServer())
        .get(url())
        .query({ type: TypeNotification.PAIEMENT })
        .set(alice.entetes)
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });

    it('refuse un champ de tri hors liste blanche', async () => {
      await request(app.getHttpServer())
        .get(url())
        .query({ tri: 'nom; DROP TABLE users' })
        .set(alice.entetes)
        .expect(400);
    });
  });

  describe('mutations', () => {
    it('marque une notification comme lue', async () => {
      const n = await creerPour(alice);

      await request(app.getHttpServer())
        .patch(url(`/${n!.id}/lu`))
        .set(alice.entetes)
        .expect(204);

      await expect(
        notifications.findOne({ where: { id: n!.id } }),
      ).resolves.toMatchObject({ isRead: true });
    });

    it('marque tout comme lu sans toucher aux autres utilisateurs', async () => {
      await creerPour(alice);
      await creerPour(alice);
      await creerPour(bob);

      const reponse = await request(app.getHttpServer())
        .patch(url('/tout-lu'))
        .set(alice.entetes)
        .expect(200);

      expect(reponse.body).toEqual({ misAJour: 2 });
      await expect(notifications.countBy({ isRead: false })).resolves.toBe(1);
    });
  });

  describe('préférences', () => {
    it('renvoie tous les types, activés par défaut', async () => {
      const reponse = await request(app.getHttpServer())
        .get(url(PREFERENCES))
        .set(alice.entetes)
        .expect(200);

      const corps = reponse.body as {
        type: string;
        canalEmail: boolean;
        canalPush: boolean;
      }[];
      expect(corps).toHaveLength(Object.keys(TypeNotification).length);
      expect(corps.every((p) => p.canalEmail && p.canalPush)).toBe(true);
    });

    it('coupe le canal email sans couper l’in-app', async () => {
      await request(app.getHttpServer())
        .patch(url(PREFERENCES))
        .set(alice.entetes)
        .send({ type: TypeNotification.EVENEMENT, canalEmail: false })
        .expect(204);

      await creerPour(alice);

      // La notification consultable reste créée : elle ne dérange personne et
      // c'est la trace qui permet de retrouver l'information après coup.
      await expect(notifications.count()).resolves.toBe(1);
      expect(mailsEnvoyes).toHaveLength(0);
    });

    it('n’affecte pas les autres types', async () => {
      await request(app.getHttpServer())
        .patch(url(PREFERENCES))
        .set(alice.entetes)
        .send({ type: TypeNotification.EVENEMENT, canalEmail: false })
        .expect(204);

      await creerPour(alice, { type: TypeNotification.PAIEMENT });

      expect(mailsEnvoyes).toHaveLength(1);
    });

    it('ne crée jamais deux lignes pour le même type', async () => {
      for (const canalEmail of [false, true, false]) {
        await request(app.getHttpServer())
          .patch(url(PREFERENCES))
          .set(alice.entetes)
          .send({ type: TypeNotification.SONDAGE, canalEmail })
          .expect(204);
      }

      await expect(preferences.count()).resolves.toBe(1);
    });
  });

  describe('diffusion', () => {
    it('est refusée à un étudiant', async () => {
      await request(app.getHttpServer())
        .post(url(DIFFUSER))
        .set(alice.entetes)
        .send({
          type: TypeNotification.SYSTEME,
          titre: 'Annonce',
          message: 'Coucou',
        })
        .expect(403);
    });

    it('atteint tous les comptes vérifiés', async () => {
      const reponse = await request(app.getHttpServer())
        .post(url(DIFFUSER))
        .set(admin.entetes)
        .send({
          type: TypeNotification.SYSTEME,
          titre: 'Fermeture du bureau',
          message: 'Le bureau sera fermé lundi.',
        })
        .expect(201);

      expect(reponse.body).toEqual({ destinataires: 3 });
      await expect(notifications.count()).resolves.toBe(3);
    });

    it('exclut les comptes non vérifiés', async () => {
      // Une adresse jamais confirmée n'appartient à personne : lui écrire
      // alimente une boîte qui n'a rien demandé, sur notre quota d'envoi.
      await creerCompteAuthentifie(app, { emailVerifie: false });

      const reponse = await request(app.getHttpServer())
        .post(url(DIFFUSER))
        .set(admin.entetes)
        .send({
          type: TypeNotification.SYSTEME,
          titre: 'Annonce',
          message: 'Message',
        })
        .expect(201);

      expect(reponse.body).toEqual({ destinataires: 3 });
    });

    it('exclut les comptes désactivés', async () => {
      const desactive = await creerCompteAuthentifie(app);
      await users.update(desactive.user.id, { isActive: false });

      const reponse = await request(app.getHttpServer())
        .post(url(DIFFUSER))
        .set(admin.entetes)
        .send({
          type: TypeNotification.SYSTEME,
          titre: 'Annonce',
          message: 'Message',
        })
        .expect(201);

      expect(reponse.body).toEqual({ destinataires: 3 });
    });

    it('cible une promotion', async () => {
      await creerCompteAuthentifie(app, { promotion: 2025 });

      const reponse = await request(app.getHttpServer())
        .post(url(DIFFUSER))
        .set(admin.entetes)
        .send({
          type: TypeNotification.EVENEMENT,
          titre: 'Retrouvailles 2025',
          message: 'Réservé à votre promotion.',
          promotion: 2025,
        })
        .expect(201);

      expect(reponse.body).toEqual({ destinataires: 1 });
    });

    it('cible un rôle', async () => {
      const reponse = await request(app.getHttpServer())
        .post(url(DIFFUSER))
        .set(admin.entetes)
        .send({
          type: TypeNotification.SYSTEME,
          titre: 'Réunion du bureau',
          message: 'Demain 18 h.',
          roles: [Role.ADMIN],
        })
        .expect(201);

      expect(reponse.body).toEqual({ destinataires: 1 });
    });

    it('ne diffuse à personne quand aucune génération n’est active', async () => {
      // « Les finissants » ne désigne alors personne. Interpréter cela comme
      // « tout le monde » enverrait une annonce ciblée à toute la plateforme.
      const reponse = await request(app.getHttpServer())
        .post(url(DIFFUSER))
        .set(admin.entetes)
        .send({
          type: TypeNotification.EVENEMENT,
          titre: 'Réservé aux finissants',
          message: 'Message',
          finissantsSeulement: true,
        })
        .expect(201);

      expect(reponse.body).toEqual({ destinataires: 0 });
      await expect(notifications.count()).resolves.toBe(0);
    });
  });

  describe('entretien', () => {
    it('ne purge que les notifications lues et anciennes', async () => {
      const ancienneLue = await creerPour(alice);
      const ancienneNonLue = await creerPour(alice);
      const recenteLue = await creerPour(alice);

      const vieux = new Date(Date.now() - 200 * 24 * 3600 * 1000);
      await notifications.update(ancienneLue!.id, {
        isRead: true,
        createdAt: vieux,
      });
      await notifications.update(ancienneNonLue!.id, { createdAt: vieux });
      await notifications.update(recenteLue!.id, { isRead: true });

      await expect(service.purgerAnciennes()).resolves.toBe(1);
      await expect(notifications.count()).resolves.toBe(2);
    });
  });

  describe('purge des comptes non vérifiés', () => {
    it('supprime les non vérifiés anciens, conserve tout le reste', async () => {
      const purge = app.get(PurgeComptesService);

      const nonVerifieAncien = await creerCompteAuthentifie(app, {
        emailVerifie: false,
      });
      const nonVerifieRecent = await creerCompteAuthentifie(app, {
        emailVerifie: false,
      });
      const sponsorEnAttente = await creerCompteAuthentifie(app, {
        role: Role.SPONSOR,
        emailVerifie: false,
      });

      const vieux = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      await users.update(nonVerifieAncien.user.id, { createdAt: vieux });
      // Un sponsor invité attend parfois longtemps avant de cliquer : le
      // supprimer effacerait un partenariat négocié hors de la plateforme.
      await users.update(sponsorEnAttente.user.id, { createdAt: vieux });

      await expect(purge.purger()).resolves.toBe(1);

      await expect(
        users.countBy({ id: nonVerifieAncien.user.id }),
      ).resolves.toBe(0);
      await expect(
        users.countBy({ id: nonVerifieRecent.user.id }),
      ).resolves.toBe(1);
      await expect(
        users.countBy({ id: sponsorEnAttente.user.id }),
      ).resolves.toBe(1);
      await expect(users.countBy({ id: alice.user.id })).resolves.toBe(1);
    });

    it('ne touche jamais un compte vérifié, même très ancien', async () => {
      // Un visiteur externe vérifié est un utilisateur légitime : rien ne
      // justifie de le supprimer parce qu'il n'est pas étudiant.
      const purge = app.get(PurgeComptesService);
      await users.update(alice.user.id, {
        createdAt: new Date(Date.now() - 900 * 24 * 3600 * 1000),
      });

      await purge.purger();

      await expect(users.countBy({ id: alice.user.id })).resolves.toBe(1);
    });
  });
});
