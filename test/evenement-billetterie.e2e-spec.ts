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
  Inscription,
  StatutInscription,
} from './../src/modules/billetterie/entities/inscription.entity';
import {
  Evenement,
  StatutEvenement,
  TypeEvenement,
} from './../src/modules/evenement/entities/evenement.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { Notification } from './../src/modules/notification/entities/notification.entity';
import { MethodePaiement } from './../src/modules/paiement/enums/paiement.enum';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const EVENEMENTS = '/api/v1/evenements';
const BILLETS = '/api/v1/billets';
const ANNEE_ACTIVE = 2027;

describe('Événements et billetterie (e2e)', () => {
  let app: INestApplication<App>;
  let evenements: Repository<Evenement>;
  let inscriptions: Repository<Inscription>;
  let generations: Repository<Generation>;
  let notifications: Repository<Notification>;

  let admin: CompteDeTest;
  let finissant: CompteDeTest;
  let ancien: CompteDeTest;
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

  const dans = (jours: number) =>
    new Date(Date.now() + jours * 86_400_000).toISOString();

  const creerEvenement = (surcharge: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(EVENEMENTS)
      .set(admin.entetes)
      .send({
        titre: 'Gala des finissants',
        description: 'Soirée de clôture du mandat.',
        dateDebut: dans(30),
        lieu: 'Campus UCAC-ICAM',
        ...surcharge,
      });

  /** Crée puis publie, et renvoie l'identifiant. */
  const creerEtPublier = async (
    surcharge: Record<string, unknown> = {},
  ): Promise<string> => {
    const reponse = await creerEvenement(surcharge).expect(201);
    const id = (reponse.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`${EVENEMENTS}/${id}/publier`)
      .set(admin.entetes)
      .expect(201);
    return id;
  };

  const sInscrire = (id: string, compte: CompteDeTest, corps = {}) =>
    request(app.getHttpServer())
      .post(`${EVENEMENTS}/${id}/inscription`)
      .set(compte.entetes)
      .send(corps);

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

    evenements = app.get(getRepositoryToken(Evenement));
    inscriptions = app.get(getRepositoryToken(Inscription));
    generations = app.get(getRepositoryToken(Generation));
    notifications = app.get(getRepositoryToken(Notification));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await inscriptions.createQueryBuilder().delete().execute();
    await notifications.createQueryBuilder().delete().execute();
    await evenements.createQueryBuilder().delete().execute();
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
    // Un ancien reste STUDENT : c'est tout l'intérêt du cas.
    ancien = await creerCompteAuthentifie(app, { promotion: 2023 });
    externe = await creerCompteAuthentifie(app, { role: Role.VISITOR });
  });

  afterAll(async () => {
    await inscriptions.createQueryBuilder().delete().execute();
    await notifications.createQueryBuilder().delete().execute();
    await evenements.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('visibilité', () => {
    it('cache les brouillons au public', async () => {
      await creerEvenement().expect(201);

      const reponse = await request(app.getHttpServer())
        .get(EVENEMENTS)
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(0);
    });

    it('répond 404 sur un brouillon, comme sur un identifiant inconnu', async () => {
      // Distinguer les deux révélerait l'existence d'un brouillon, titre
      // compris, à qui devine une URL.
      const reponse = await creerEvenement().expect(201);
      const id = (reponse.body as { id: string }).id;

      await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}`)
        .set(finissant.entetes)
        .expect(404);
    });

    it('montre les brouillons à l’administration', async () => {
      await creerEvenement().expect(201);

      const reponse = await request(app.getHttpServer())
        .get(EVENEMENTS)
        .query({ statut: StatutEvenement.BROUILLON })
        .set(admin.entetes)
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });

    it('ignore un filtre de statut venant d’un non-administrateur', async () => {
      // La demande explicite d'un brouillon ne doit pas contourner la règle.
      await creerEvenement().expect(201);

      const reponse = await request(app.getHttpServer())
        .get(EVENEMENTS)
        .query({ statut: StatutEvenement.BROUILLON })
        .set(finissant.entetes)
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(0);
    });

    it('refuse la création à un étudiant', async () => {
      const reponse = await request(app.getHttpServer())
        .post(EVENEMENTS)
        .set(finissant.entetes)
        .send({
          titre: 'Fête sauvage',
          description: 'Sans autorisation du bureau.',
          dateDebut: dans(10),
          lieu: 'Ailleurs',
        });

      expect(reponse.status).toBe(403);
    });
  });

  describe('tarif applicable', () => {
    const PAYANT = {
      type: TypeEvenement.PAYANT,
      prixCampus: 5000,
      prixExterne: 15000,
    };

    it('applique le tarif campus à un finissant', async () => {
      const id = await creerEtPublier(PAYANT);

      const reponse = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}`)
        .set(finissant.entetes)
        .expect(200);

      expect(reponse.body).toMatchObject({
        prixApplicable: 5000,
        tarifCampus: true,
      });
    });

    it('applique le tarif externe à un ancien, malgré son rôle STUDENT', async () => {
      // Le cas que le backlog décrivait de travers : le tarif ne découle pas
      // du rôle mais de la promotion.
      const id = await creerEtPublier(PAYANT);

      const reponse = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}`)
        .set(ancien.entetes)
        .expect(200);

      expect(reponse.body).toMatchObject({
        prixApplicable: 15000,
        tarifCampus: false,
      });
    });

    it('applique le tarif externe à un visiteur non connecté', async () => {
      const id = await creerEtPublier(PAYANT);

      const reponse = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}`)
        .expect(200);

      expect(reponse.body).toMatchObject({
        prixApplicable: 15000,
        tarifCampus: false,
      });
    });

    it('ignore les tarifs d’un événement gratuit', async () => {
      const id = await creerEtPublier({ prixCampus: 5000, prixExterne: 9000 });

      const reponse = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}`)
        .set(finissant.entetes)
        .expect(200);

      expect((reponse.body as { prixApplicable: number }).prixApplicable).toBe(
        0,
      );
    });
  });

  describe('inscription', () => {
    it('inscrit et délivre un code de billet imprévisible', async () => {
      const id = await creerEtPublier();

      const reponse = await sInscrire(id, finissant).expect(201);
      const billet = reponse.body as { codeBillet: string; statut: string };

      expect(billet.statut).toBe(StatutInscription.CONFIRMEE);
      expect(billet.codeBillet).toMatch(/^COCFET-[0-9A-F]{12}$/);
    });

    it('refuse une seconde inscription au même événement', async () => {
      const id = await creerEtPublier();
      await sInscrire(id, finissant).expect(201);

      await sInscrire(id, finissant).expect(409);
      await expect(inscriptions.count()).resolves.toBe(1);
    });

    it('refuse un événement non publié', async () => {
      const reponse = await creerEvenement().expect(201);

      await sInscrire((reponse.body as { id: string }).id, finissant).expect(
        404,
      );
    });

    it('refuse un événement sur invitation', async () => {
      const id = await creerEtPublier({ type: TypeEvenement.SUR_INVITATION });

      await sInscrire(id, finissant).expect(400);
    });

    it('exige un moyen de paiement pour un événement payant', async () => {
      const id = await creerEtPublier({
        type: TypeEvenement.PAYANT,
        prixCampus: 5000,
        prixExterne: 5000,
      });

      await sInscrire(id, finissant).expect(400);
      // Aucune place ne doit rester consommée par une tentative refusée.
      await expect(
        evenements.findOne({ where: { id } }),
      ).resolves.toMatchObject({ inscriptionsActuelles: 0 });
    });

    it('rend la place quand le paiement est refusé', async () => {
      // La passerelle factice refuse tout numéro se terminant par 0.
      const id = await creerEtPublier({
        type: TypeEvenement.PAYANT,
        prixCampus: 5000,
        prixExterne: 5000,
        capaciteMax: 1,
      });

      await sInscrire(id, finissant, {
        methodePaiement: MethodePaiement.MTN_MOMO,
        telephone: '+237699000000',
      }).expect(400);

      await expect(
        evenements.findOne({ where: { id } }),
      ).resolves.toMatchObject({ inscriptionsActuelles: 0 });
      await expect(inscriptions.count()).resolves.toBe(0);

      // La place est donc bien disponible pour quelqu'un d'autre.
      await sInscrire(id, ancien, {
        methodePaiement: MethodePaiement.MTN_MOMO,
        telephone: '+237699000002',
      }).expect(201);
    });

    it('fige le prix payé sur le billet', async () => {
      const id = await creerEtPublier({
        type: TypeEvenement.PAYANT,
        prixCampus: 5000,
        prixExterne: 15000,
      });

      const reponse = await sInscrire(id, ancien, {
        methodePaiement: MethodePaiement.ORANGE_MONEY,
        telephone: '+237699000002',
      }).expect(201);

      expect((reponse.body as { prix: number }).prix).toBe(15000);
    });

    it('notifie la personne inscrite', async () => {
      const id = await creerEtPublier();
      await sInscrire(id, finissant).expect(201);

      const recues = await notifications.find({
        where: { user: { id: finissant.user.id } },
      });
      expect(
        recues.some((n) => n.titre.includes('Inscription confirmée')),
      ).toBe(true);
    });
  });

  describe('capacité', () => {
    it('refuse au-delà de la capacité', async () => {
      const id = await creerEtPublier({ capaciteMax: 1 });

      await sInscrire(id, finissant).expect(201);
      await sInscrire(id, ancien).expect(409);
    });

    it('ne vend jamais deux fois la dernière place', async () => {
      // Le cœur du sujet : trois inscriptions simultanées sur une seule place.
      // Lire puis écrire laisserait les trois passer la vérification avant
      // qu'aucune n'ait écrit — c'est ainsi qu'on survend.
      const id = await creerEtPublier({ capaciteMax: 1 });

      const resultats = await Promise.all([
        sInscrire(id, finissant),
        sInscrire(id, ancien),
        sInscrire(id, externe),
      ]);

      const reussites = resultats.filter((r) => r.status === 201);
      expect(reussites).toHaveLength(1);
      expect(resultats.filter((r) => r.status === 409)).toHaveLength(2);

      await expect(inscriptions.count()).resolves.toBe(1);
      await expect(
        evenements.findOne({ where: { id } }),
      ).resolves.toMatchObject({ inscriptionsActuelles: 1 });
    });

    it('traite une capacité nulle comme illimitée', async () => {
      const id = await creerEtPublier({ capaciteMax: 0 });

      await sInscrire(id, finissant).expect(201);
      await sInscrire(id, ancien).expect(201);
      await sInscrire(id, externe).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}`)
        .expect(200);
      expect(reponse.body).toMatchObject({
        placesRestantes: null,
        complet: false,
      });
    });

    it('refuse de réduire la capacité sous le nombre d’inscrits', async () => {
      const id = await creerEtPublier({ capaciteMax: 5 });
      await sInscrire(id, finissant).expect(201);
      await sInscrire(id, ancien).expect(201);

      await request(app.getHttpServer())
        .patch(`${EVENEMENTS}/${id}`)
        .set(admin.entetes)
        .send({ capaciteMax: 1 })
        .expect(400);
    });
  });

  describe('annulation', () => {
    it('libère la place', async () => {
      const id = await creerEtPublier({ capaciteMax: 1 });
      const reponse = await sInscrire(id, finissant).expect(201);
      const billetId = (reponse.body as { id: string }).id;

      await request(app.getHttpServer())
        .delete(`${BILLETS}/${billetId}`)
        .set(finissant.entetes)
        .expect(204);

      await sInscrire(id, ancien).expect(201);
    });

    it('autorise une réinscription après désistement', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);

      await request(app.getHttpServer())
        .delete(`${BILLETS}/${(reponse.body as { id: string }).id}`)
        .set(finissant.entetes)
        .expect(204);

      await sInscrire(id, finissant).expect(201);
    });

    it('refuse d’annuler le billet d’autrui', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);

      await request(app.getHttpServer())
        .delete(`${BILLETS}/${(reponse.body as { id: string }).id}`)
        .set(ancien.entetes)
        .expect(404);

      await expect(
        inscriptions.countBy({ statut: StatutInscription.CONFIRMEE }),
      ).resolves.toBe(1);
    });
  });

  describe('contrôle à l’entrée', () => {
    const scanner = (code: string, compte: CompteDeTest) =>
      request(app.getHttpServer())
        .post(`${BILLETS}/scanner`)
        .set(compte.entetes)
        .send({ codeBillet: code });

    it('valide un billet une fois, et une seule', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);
      const code = (reponse.body as { codeBillet: string }).codeBillet;

      const premier = await scanner(code, admin).expect(201);
      expect((premier.body as { statut: string }).statut).toBe(
        StatutInscription.UTILISEE,
      );

      await scanner(code, admin).expect(409);
    });

    it('résiste à deux scans simultanés du même code', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);
      const code = (reponse.body as { codeBillet: string }).codeBillet;

      const resultats = await Promise.all([
        scanner(code, admin),
        scanner(code, admin),
      ]);

      expect(resultats.filter((r) => r.status === 201)).toHaveLength(1);
      expect(resultats.filter((r) => r.status === 409)).toHaveLength(1);
    });

    it('refuse un billet annulé', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);
      const billet = reponse.body as { id: string; codeBillet: string };

      await request(app.getHttpServer())
        .delete(`${BILLETS}/${billet.id}`)
        .set(finissant.entetes)
        .expect(204);

      await scanner(billet.codeBillet, admin).expect(409);
    });

    it('refuse le scan à un étudiant', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);

      await scanner(
        (reponse.body as { codeBillet: string }).codeBillet,
        finissant,
      ).expect(403);
    });

    it('signale un code inconnu', async () => {
      await scanner('COCFET-INEXISTANT', admin).expect(404);
    });
  });

  describe('billets', () => {
    it('ne montre à chacun que ses propres billets', async () => {
      const id = await creerEtPublier();
      await sInscrire(id, finissant).expect(201);
      await sInscrire(id, ancien).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(BILLETS)
        .set(finissant.entetes)
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });

    it('refuse de lire le billet d’autrui, code d’entrée compris', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);

      await request(app.getHttpServer())
        .get(`${BILLETS}/${(reponse.body as { id: string }).id}`)
        .set(ancien.entetes)
        .expect(404);
    });
  });

  describe('publication et suppression', () => {
    it('ne renotifie pas une republication', async () => {
      // Une correction de faute de frappe ne doit pas alerter la promotion.
      const id = await creerEtPublier();
      const apresPremiere = await notifications.count();

      await request(app.getHttpServer())
        .post(`${EVENEMENTS}/${id}/publier`)
        .set(admin.entetes)
        .expect(201);

      await expect(notifications.count()).resolves.toBe(apresPremiere);
    });

    it('refuse de publier un événement déjà passé', async () => {
      const reponse = await creerEvenement().expect(201);
      const id = (reponse.body as { id: string }).id;
      await evenements.update(id, {
        dateDebut: new Date(Date.now() - 3600_000),
      });

      await request(app.getHttpServer())
        .post(`${EVENEMENTS}/${id}/publier`)
        .set(admin.entetes)
        .expect(400);
    });

    it('refuse la suppression dès qu’un billet existe', async () => {
      const id = await creerEtPublier();
      await sInscrire(id, finissant).expect(201);

      await request(app.getHttpServer())
        .delete(`${EVENEMENTS}/${id}`)
        .set(admin.entetes)
        .expect(403);
    });

    it('autorise la suppression d’un événement sans inscription', async () => {
      const reponse = await creerEvenement().expect(201);

      await request(app.getHttpServer())
        .delete(`${EVENEMENTS}/${(reponse.body as { id: string }).id}`)
        .set(admin.entetes)
        .expect(204);

      await expect(evenements.count()).resolves.toBe(0);
    });

    it('refuse une date de fin antérieure au début', async () => {
      await creerEvenement({ dateDebut: dans(30), dateFin: dans(29) }).expect(
        400,
      );
    });
  });
  describe('filtres de recherche', () => {
    it('filtre par type', async () => {
      await creerEtPublier();
      await creerEtPublier({
        titre: 'Conférence payante',
        type: TypeEvenement.PAYANT,
        prixCampus: 1000,
        prixExterne: 2000,
      });

      const reponse = await request(app.getHttpServer())
        .get(EVENEMENTS)
        .query({ type: TypeEvenement.PAYANT })
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });

    it('filtre les événements à venir', async () => {
      const passe = await creerEtPublier();
      await evenements.update(passe, {
        dateDebut: new Date(Date.now() - 86_400_000),
      });
      await creerEtPublier({ titre: 'Encore à venir' });

      const reponse = await request(app.getHttpServer())
        .get(EVENEMENTS)
        .query({ aVenir: 'true' })
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });

    it('cherche dans le titre et le lieu', async () => {
      await creerEtPublier({ titre: 'Gala de clôture' });
      await creerEtPublier({ titre: 'Atelier CV', lieu: 'Salle Bordeaux' });

      const parTitre = await request(app.getHttpServer())
        .get(EVENEMENTS)
        .query({ recherche: 'gala' })
        .expect(200);
      expect((parTitre.body as { donnees: unknown[] }).donnees).toHaveLength(1);

      const parLieu = await request(app.getHttpServer())
        .get(EVENEMENTS)
        .query({ recherche: 'bordeaux' })
        .expect(200);
      expect((parLieu.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });

    it('traite le motif de recherche comme une donnée, jamais comme du SQL', async () => {
      await creerEtPublier();

      const reponse = await request(app.getHttpServer())
        .get(EVENEMENTS)
        .query({ recherche: "%' OR 1=1 --" })
        .expect(200);

      // Si le motif était concaténé, la clause s'ouvrirait et tout remonterait.
      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(0);
      await expect(evenements.count()).resolves.toBe(1);
    });

    it('refuse un identifiant mal formé', async () => {
      await request(app.getHttpServer())
        .get(`${EVENEMENTS}/pas-un-uuid`)
        .expect(400);
    });
  });

  describe('archivage', () => {
    it('retire l’événement de la liste publique', async () => {
      const id = await creerEtPublier();

      await request(app.getHttpServer())
        .post(`${EVENEMENTS}/${id}/archiver`)
        .set(admin.entetes)
        .expect(201);

      const reponse = await request(app.getHttpServer())
        .get(EVENEMENTS)
        .expect(200);
      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(0);
    });

    it('refuse de republier un événement archivé', async () => {
      const id = await creerEtPublier();
      await request(app.getHttpServer())
        .post(`${EVENEMENTS}/${id}/archiver`)
        .set(admin.entetes)
        .expect(201);

      await request(app.getHttpServer())
        .post(`${EVENEMENTS}/${id}/publier`)
        .set(admin.entetes)
        .expect(400);
    });

    it('modifie les dates d’un événement existant', async () => {
      const id = await creerEtPublier();

      const reponse = await request(app.getHttpServer())
        .patch(`${EVENEMENTS}/${id}`)
        .set(admin.entetes)
        .send({ dateDebut: dans(45), dateFin: dans(46) })
        .expect(200);

      expect(
        new Date((reponse.body as { dateFin: string }).dateFin).getTime(),
      ).toBeGreaterThan(
        new Date((reponse.body as { dateDebut: string }).dateDebut).getTime(),
      );
    });
  });

  describe('gestion des billets', () => {
    it('filtre ses billets par statut et par échéance', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);

      const confirmes = await request(app.getHttpServer())
        .get(BILLETS)
        .query({ statut: StatutInscription.CONFIRMEE, aVenir: 'true' })
        .set(finissant.entetes)
        .expect(200);
      expect((confirmes.body as { donnees: unknown[] }).donnees).toHaveLength(
        1,
      );

      await request(app.getHttpServer())
        .delete(`${BILLETS}/${(reponse.body as { id: string }).id}`)
        .set(finissant.entetes)
        .expect(204);

      const annules = await request(app.getHttpServer())
        .get(BILLETS)
        .query({ statut: StatutInscription.ANNULEE })
        .set(finissant.entetes)
        .expect(200);
      expect((annules.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });

    it('reste sans effet quand on annule deux fois', async () => {
      // La place ne doit être rendue qu'une seule fois, sinon le compteur
      // passerait sous le nombre réel d'inscrits.
      const id = await creerEtPublier({ capaciteMax: 5 });
      const reponse = await sInscrire(id, finissant).expect(201);
      const billetId = (reponse.body as { id: string }).id;

      await request(app.getHttpServer())
        .delete(`${BILLETS}/${billetId}`)
        .set(finissant.entetes)
        .expect(204);
      await request(app.getHttpServer())
        .delete(`${BILLETS}/${billetId}`)
        .set(finissant.entetes)
        .expect(204);

      await expect(
        evenements.findOne({ where: { id } }),
      ).resolves.toMatchObject({ inscriptionsActuelles: 0 });
    });

    it('refuse l’annulation après le début de l’événement', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);
      await evenements.update(id, {
        dateDebut: new Date(Date.now() - 3600_000),
      });

      await request(app.getHttpServer())
        .delete(`${BILLETS}/${(reponse.body as { id: string }).id}`)
        .set(finissant.entetes)
        .expect(409);
    });

    it('refuse d’annuler un billet déjà scanné', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);
      const billet = reponse.body as { id: string; codeBillet: string };

      await request(app.getHttpServer())
        .post(`${BILLETS}/scanner`)
        .set(admin.entetes)
        .send({ codeBillet: billet.codeBillet })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`${BILLETS}/${billet.id}`)
        .set(finissant.entetes)
        .expect(409);
    });

    it('refuse le scan d’un billet resté impayé', async () => {
      // La passerelle factice laisse en attente tout numéro finissant par 1.
      const id = await creerEtPublier({
        type: TypeEvenement.PAYANT,
        prixCampus: 5000,
        prixExterne: 5000,
      });
      const reponse = await sInscrire(id, finissant, {
        methodePaiement: MethodePaiement.MTN_MOMO,
        telephone: '+237699000001',
      }).expect(201);

      const billet = reponse.body as { statut: string; codeBillet: string };
      expect(billet.statut).toBe(StatutInscription.EN_ATTENTE);

      await request(app.getHttpServer())
        .post(`${BILLETS}/scanner`)
        .set(admin.entetes)
        .send({ codeBillet: billet.codeBillet })
        .expect(409);
    });

    it('liste les inscrits d’un événement pour le bureau', async () => {
      const id = await creerEtPublier();
      await sInscrire(id, finissant).expect(201);
      await sInscrire(id, ancien).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}/inscriptions`)
        .query({ statut: StatutInscription.CONFIRMEE })
        .set(admin.entetes)
        .expect(200);

      expect((reponse.body as { meta: { total: number } }).meta.total).toBe(2);
    });

    it('refuse la liste des inscrits à un étudiant', async () => {
      const id = await creerEtPublier();

      await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}/inscriptions`)
        .set(finissant.entetes)
        .expect(403);
    });
  });

  describe('émission du billet', () => {
    it('génère le QR code et envoie le billet à la confirmation', async () => {
      const id = await creerEtPublier();

      const reponse = await sInscrire(id, finissant).expect(201);
      const billet = reponse.body as { id: string; codeBillet: string };

      const enregistre = await inscriptions.findOneByOrFail({ id: billet.id });
      expect(enregistre.qrCode).toMatch(/^data:image\/png;base64,/);

      expect(faussaireMail.envoyerBillet).toHaveBeenCalledTimes(1);
      const [destinataire, , contenu] = faussaireMail.envoyerBillet.mock
        .calls[0] as [string, string, { codeBillet: string; qrPng: Buffer }];

      expect(destinataire).toBe(finissant.user.email);
      expect(contenu.codeBillet).toBe(billet.codeBillet);
      expect(Buffer.isBuffer(contenu.qrPng)).toBe(true);
    });

    it('n’émet aucun billet tant que le paiement est en attente', async () => {
      const id = await creerEtPublier({
        type: TypeEvenement.PAYANT,
        prixCampus: 5000,
        prixExterne: 10_000,
      });

      // Numéro terminé par 1 : la passerelle factice laisse le paiement en
      // attente, comme un webhook qui n'arrive pas. La place est réservée, le
      // billet ne vaut pas encore droit d'entrée — donc pas de QR, pas d'email.
      const reponse = await sInscrire(id, finissant, {
        methodePaiement: MethodePaiement.MTN_MOMO,
        telephone: '670000001',
      }).expect(201);
      const billet = reponse.body as { id: string; statut: string };

      expect(billet.statut).toBe(StatutInscription.EN_ATTENTE);
      await expect(
        inscriptions.findOneByOrFail({ id: billet.id }),
      ).resolves.toMatchObject({ qrCode: null });
      expect(faussaireMail.envoyerBillet).not.toHaveBeenCalled();
    });

    it('renvoie le billet à la demande', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);
      const billet = reponse.body as { id: string; codeBillet: string };

      jest.clearAllMocks();

      await request(app.getHttpServer())
        .post(`${BILLETS}/${billet.id}/renvoyer`)
        .set(finissant.entetes)
        .expect(202);

      expect(faussaireMail.envoyerBillet).toHaveBeenCalledTimes(1);
    });

    it('refuse de renvoyer le billet d’autrui', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);
      const billet = reponse.body as { id: string };

      await request(app.getHttpServer())
        .post(`${BILLETS}/${billet.id}/renvoyer`)
        .set(ancien.entetes)
        .expect(404);
    });

    it('refuse de renvoyer un billet annulé', async () => {
      const id = await creerEtPublier();
      const reponse = await sInscrire(id, finissant).expect(201);
      const billet = reponse.body as { id: string };

      await request(app.getHttpServer())
        .delete(`${BILLETS}/${billet.id}`)
        .set(finissant.entetes)
        .expect(204);

      await request(app.getHttpServer())
        .post(`${BILLETS}/${billet.id}/renvoyer`)
        .set(finissant.entetes)
        .expect(409);
    });

    it('laisse l’inscription valide quand l’envoi échoue', async () => {
      const id = await creerEtPublier();
      faussaireMail.envoyerBillet.mockRejectedValueOnce(new Error('SMTP mort'));

      // Le cœur du récit : la place est payée et le code est en base. Une
      // panne SMTP ne doit pas rendre la place ni supprimer le billet.
      const reponse = await sInscrire(id, finissant).expect(201);
      const billet = reponse.body as { id: string; statut: string };

      expect(billet.statut).toBe(StatutInscription.CONFIRMEE);
      await expect(
        inscriptions.findOneByOrFail({ id: billet.id }),
      ).resolves.toMatchObject({ statut: StatutInscription.CONFIRMEE });
    });
  });
});
