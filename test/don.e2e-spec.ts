import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { Don, TypeDonateur } from './../src/modules/don/entities/don.entity';
import {
  Evenement,
  TypeEvenement,
} from './../src/modules/evenement/entities/evenement.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { AlerteTresorerieService } from './../src/modules/notification/alerte-tresorerie.service';
import { Notification } from './../src/modules/notification/entities/notification.entity';
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

const DONS = '/api/v1/dons';
const WEBHOOK = '/api/v1/webhooks/fapshi';
const SECRET_WEBHOOK = 'secret-de-developpement';

/** Numéro hors des listes du bac à sable : le paiement reste en attente. */
const TELEPHONE_EN_ATTENTE = '+237677123456';

/**
 * Les dons, de bout en bout : n'importe qui peut donner, au comité en général
 * ou pour un événement, anonymement ou en se faisant connaître ; le bureau les
 * lit derrière le privilège de trésorerie.
 */
describe('Dons (e2e)', () => {
  let app: INestApplication<App>;
  let dons: Repository<Don>;
  let evenements: Repository<Evenement>;
  let transactions: Repository<Transaction>;
  let notifications: Repository<Notification>;

  let exploitation: CompteDeTest;
  let membre: CompteDeTest;
  let donRecu: jest.SpyInstance;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBillet: jest.fn().mockResolvedValue(undefined),
  };

  const GENERAL = { destination: 'GENERAL', montant: 10_000 };
  const PAIEMENT = {
    methodePaiement: MethodePaiement.MTN_MOMO,
    telephone: TELEPHONE_EN_ATTENTE,
  };

  const donner = (corps: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(DONS)
      .send({ ...PAIEMENT, ...corps });

  const reference = (reponse: request.Response): string =>
    (reponse.body as { reference: string }).reference;

  /** Les remerciements envoyés aux donateurs (et non les alertes du bureau). */
  const remerciements = (): unknown[][] =>
    (faussaireMail.envoyerNotification.mock.calls as unknown[][]).filter(
      (appel) => appel[2] === 'Merci pour votre don',
    );

  const notifierPaiement = (ref: string, statut: StatutPaiement) =>
    request(app.getHttpServer())
      .post(WEBHOOK)
      .set('Content-Type', 'application/json')
      .set('x-wh-secret', SECRET_WEBHOOK)
      .send(
        JSON.stringify({
          reference: ref,
          referenceExterne: 'trx_simule',
          statut,
        }),
      )
      .expect(200);

  const evenementPublie = async (
    titre = 'Gala de clôture',
  ): Promise<string> => {
    const cree = await request(app.getHttpServer())
      .post('/api/v1/evenements')
      .set(exploitation.entetes)
      .send({
        titre,
        description: 'Soirée de clôture du mandat.',
        dateDebut: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        lieu: 'Campus UCAC-ICAM',
        type: TypeEvenement.GRATUIT,
      })
      .expect(201);
    const id = (cree.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`/api/v1/evenements/${id}/publier`)
      .set(exploitation.entetes)
      .expect(201);
    return id;
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

    dons = app.get(getRepositoryToken(Don));
    evenements = app.get(getRepositoryToken(Evenement));
    transactions = app.get(getRepositoryToken(Transaction));
    notifications = app.get(getRepositoryToken(Notification));
    donRecu = jest.spyOn(app.get(AlerteTresorerieService), 'donRecu');
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await dons.createQueryBuilder().delete().execute();
    await transactions.createQueryBuilder().delete().execute();
    await notifications.createQueryBuilder().delete().execute();
    await evenements.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);

    exploitation = await creerCompteAuthentifie(app, {
      role: Role.SUPER_ADMIN,
      promotion: null,
    });
    membre = await creerCompteAuthentifie(app, { role: Role.STUDENT });
  });

  afterAll(async () => {
    await dons.createQueryBuilder().delete().execute();
    await transactions.createQueryBuilder().delete().execute();
    await notifications.createQueryBuilder().delete().execute();
    await evenements.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('lancer un don', () => {
    it('accepte un don anonyme sans compte, et n’en garde aucune identité', async () => {
      const reponse = await donner({ ...GENERAL, anonyme: true }).expect(201);

      const don = await dons.findOneOrFail({
        where: { reference: reference(reponse) },
      });
      expect(don).toMatchObject({
        anonyme: true,
        montant: 10_000,
        statut: StatutPaiement.EN_ATTENTE,
        typeDonateur: null,
        prenom: null,
        nom: null,
        raisonSociale: null,
        email: null,
      });
      // Les frais s'ajoutent : le comité reçoit bien les 10 000 annoncés.
      expect(don.montantDebite).toBeGreaterThan(don.montant);
    });

    it('ouvre une transaction de don, au montant débité', async () => {
      const reponse = await donner({ ...GENERAL, anonyme: true }).expect(201);

      const transaction = await transactions.findOneOrFail({
        where: { reference: reference(reponse) },
      });
      expect(transaction).toMatchObject({
        origine: OrigineTransaction.DON,
        statut: StatutPaiement.EN_ATTENTE,
      });
      const don = await dons.findOneByOrFail({ reference: reference(reponse) });
      expect(transaction.montant).toBe(don.montantDebite);
    });

    it('ne rattache aucun compte à un don anonyme, même connecté', async () => {
      const reponse = await donner({ ...GENERAL, anonyme: true })
        .set(membre.entetes)
        .expect(201);

      const don = await dons.findOneOrFail({
        where: { reference: reference(reponse) },
        relations: { user: true },
      });
      expect(don.user).toBeNull();
    });

    it('garde l’identité d’un particulier qui veut être connu', async () => {
      const reponse = await donner({
        ...GENERAL,
        anonyme: false,
        typeDonateur: TypeDonateur.PARTICULIER,
        prenom: 'Aminata',
        nom: 'Nkoulou',
        email: 'Aminata@Exemple.cm',
      }).expect(201);

      await expect(
        dons.findOneByOrFail({ reference: reference(reponse) }),
      ).resolves.toMatchObject({
        anonyme: false,
        typeDonateur: TypeDonateur.PARTICULIER,
        prenom: 'Aminata',
        nom: 'Nkoulou',
        raisonSociale: null,
        email: 'aminata@exemple.cm',
      });
    });

    it('garde la raison sociale d’une entreprise, sans nom de particulier', async () => {
      const reponse = await donner({
        ...GENERAL,
        anonyme: false,
        typeDonateur: TypeDonateur.ENTREPRISE,
        raisonSociale: 'Brasseries du Cameroun',
        contact: 'Mme Fotso',
        email: 'dons@brasseries.cm',
        // Ignorés : ce ne sont pas les champs d'une entreprise.
        prenom: 'Ignoré',
        nom: 'Ignoré',
      }).expect(201);

      await expect(
        dons.findOneByOrFail({ reference: reference(reponse) }),
      ).resolves.toMatchObject({
        typeDonateur: TypeDonateur.ENTREPRISE,
        raisonSociale: 'Brasseries du Cameroun',
        contact: 'Mme Fotso',
        prenom: null,
        nom: null,
      });
    });

    it('rattache le compte d’un donateur connecté qui veut être connu', async () => {
      const reponse = await donner({
        ...GENERAL,
        anonyme: false,
        typeDonateur: TypeDonateur.PARTICULIER,
        prenom: 'Étudiant',
        nom: 'Test',
        email: 'etudiant@exemple.cm',
      })
        .set(membre.entetes)
        .expect(201);

      const don = await dons.findOneOrFail({
        where: { reference: reference(reponse) },
        relations: { user: true },
      });
      expect(don.user?.id).toBe(membre.user.id);
    });

    it('lie le don à un événement publié', async () => {
      const id = await evenementPublie();

      const reponse = await donner({
        destination: 'EVENEMENT',
        evenementId: id,
        montant: 5000,
        anonyme: true,
      }).expect(201);

      const don = await dons.findOneOrFail({
        where: { reference: reference(reponse) },
        relations: { evenement: true },
      });
      expect(don.evenement?.id).toBe(id);
    });

    it.each([
      ['une destination absente', { montant: 10_000, anonyme: true }],
      [
        'un événement sans identifiant',
        { destination: 'EVENEMENT', montant: 10_000, anonyme: true },
      ],
      [
        'un montant sous le minimum',
        { ...GENERAL, montant: 100, anonyme: true },
      ],
      ['un montant décimal', { ...GENERAL, montant: 1000.5, anonyme: true }],
      ['un don connu sans type', { ...GENERAL, anonyme: false }],
      [
        'un particulier sans nom',
        {
          ...GENERAL,
          anonyme: false,
          typeDonateur: 'PARTICULIER',
          prenom: 'Aminata',
          email: 'a@exemple.cm',
        },
      ],
      [
        'un don connu sans email',
        {
          ...GENERAL,
          anonyme: false,
          typeDonateur: 'ENTREPRISE',
          raisonSociale: 'Société Test',
        },
      ],
    ])('refuse %s', async (_nom, corps) => {
      await donner(corps).expect(400);
      await expect(dons.count()).resolves.toBe(0);
    });

    it('refuse un événement inconnu ou non publié', async () => {
      await donner({
        destination: 'EVENEMENT',
        evenementId: '11111111-1111-4111-8111-111111111111',
        montant: 10_000,
        anonyme: true,
      }).expect(400);
    });
  });

  describe('issue du paiement', () => {
    it('reçoit le don, prévient la trésorerie et remercie le donateur connu', async () => {
      const id = await evenementPublie();
      const lance = await donner({
        destination: 'EVENEMENT',
        evenementId: id,
        montant: 20_000,
        anonyme: false,
        typeDonateur: TypeDonateur.ENTREPRISE,
        raisonSociale: 'Brasseries du Cameroun',
        contact: 'Mme Fotso',
        email: 'dons@brasseries.cm',
      }).expect(201);

      await notifierPaiement(reference(lance), StatutPaiement.COMPLETE);

      await expect(
        dons.findOneByOrFail({ reference: reference(lance) }),
      ).resolves.toMatchObject({ statut: StatutPaiement.COMPLETE });
      expect(donRecu).toHaveBeenCalledWith(
        'Brasseries du Cameroun',
        20_000,
        'Gala de clôture',
        null,
      );
      expect(faussaireMail.envoyerNotification).toHaveBeenCalledWith(
        'dons@brasseries.cm',
        'Mme Fotso',
        'Merci pour votre don',
        expect.stringContaining('20') as string,
        null,
      );
    });

    it('annonce « Anonyme » à la trésorerie et n’écrit à personne', async () => {
      const lance = await donner({ ...GENERAL, anonyme: true }).expect(201);

      await notifierPaiement(reference(lance), StatutPaiement.COMPLETE);

      expect(donRecu).toHaveBeenCalledWith('Anonyme', 10_000, null, null);
      expect(remerciements()).toHaveLength(0);
    });

    it('prévient dans l’application un donateur connecté', async () => {
      const lance = await donner({
        ...GENERAL,
        anonyme: false,
        typeDonateur: TypeDonateur.PARTICULIER,
        prenom: 'Étudiant',
        nom: 'Test',
        email: 'etudiant@exemple.cm',
      })
        .set(membre.entetes)
        .expect(201);

      await notifierPaiement(reference(lance), StatutPaiement.COMPLETE);

      const recues = await notifications.find();
      expect(recues.some((n) => n.titre === 'Merci pour votre don')).toBe(true);
    });

    it('ne remercie qu’une fois, même si la notification est rejouée', async () => {
      const lance = await donner({
        ...GENERAL,
        anonyme: false,
        typeDonateur: TypeDonateur.PARTICULIER,
        prenom: 'Aminata',
        nom: 'Nkoulou',
        email: 'aminata@exemple.cm',
      }).expect(201);

      await notifierPaiement(reference(lance), StatutPaiement.COMPLETE);
      await notifierPaiement(reference(lance), StatutPaiement.COMPLETE);

      expect(remerciements()).toHaveLength(1);
      expect(donRecu).toHaveBeenCalledTimes(1);
    });

    it('marque un paiement refusé, sans rien annoncer à la trésorerie', async () => {
      const lance = await donner({ ...GENERAL, anonyme: true }).expect(201);

      await notifierPaiement(reference(lance), StatutPaiement.ECHOUE);

      await expect(
        dons.findOneByOrFail({ reference: reference(lance) }),
      ).resolves.toMatchObject({ statut: StatutPaiement.ECHOUE });
      expect(donRecu).not.toHaveBeenCalled();
    });
  });

  describe('suivi public', () => {
    it('donne l’état d’un don à qui en connaît la référence, sans compte', async () => {
      const lance = await donner({ ...GENERAL, anonyme: true }).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${DONS}/suivi/${reference(lance)}`)
        .expect(200);

      expect(reponse.body).toEqual({
        reference: reference(lance),
        statut: StatutPaiement.EN_ATTENTE,
        montant: 10_000,
        evenement: null,
      });
    });

    it('ne révèle aucune identité', async () => {
      const lance = await donner({
        ...GENERAL,
        anonyme: false,
        typeDonateur: TypeDonateur.PARTICULIER,
        prenom: 'Aminata',
        nom: 'Nkoulou',
        email: 'aminata@exemple.cm',
      }).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${DONS}/suivi/${reference(lance)}`)
        .expect(200);

      expect(JSON.stringify(reponse.body)).not.toContain('Aminata');
      expect(JSON.stringify(reponse.body)).not.toContain('aminata@');
    });

    it('signale une référence inconnue', async () => {
      await request(app.getHttpServer())
        .get(`${DONS}/suivi/DON-INCONNU`)
        .expect(404);
    });
  });

  describe('lecture par le bureau', () => {
    const recevoir = async (corps: Record<string, unknown>) => {
      const lance = await donner(corps).expect(201);
      await notifierPaiement(reference(lance), StatutPaiement.COMPLETE);
    };

    it('refuse la liste à qui n’a pas la trésorerie', async () => {
      await request(app.getHttpServer()).get(DONS).expect(401);
      await request(app.getHttpServer())
        .get(DONS)
        .set(membre.entetes)
        .expect(403);
    });

    it('liste les dons reçus, et laisse de côté ceux en attente', async () => {
      await recevoir({ ...GENERAL, anonyme: true });
      await donner({ ...GENERAL, anonyme: true }).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(DONS)
        .set(exploitation.entetes)
        .expect(200);

      const corps = reponse.body as { donnees: Don[]; meta: { total: number } };
      expect(corps.meta.total).toBe(1);
      expect(corps.donnees[0].statut).toBe(StatutPaiement.COMPLETE);
    });

    it('résume au comité en général et par événement', async () => {
      const id = await evenementPublie();
      await recevoir({ ...GENERAL, montant: 10_000, anonyme: true });
      await recevoir({
        destination: 'EVENEMENT',
        evenementId: id,
        montant: 5000,
        anonyme: true,
      });
      await recevoir({
        destination: 'EVENEMENT',
        evenementId: id,
        montant: 7000,
        anonyme: true,
      });

      const reponse = await request(app.getHttpServer())
        .get(`${DONS}/resume`)
        .set(exploitation.entetes)
        .expect(200);

      expect(reponse.body).toEqual({
        total: 22_000,
        nombre: 3,
        general: { montant: 10_000, nombre: 1 },
        parEvenement: [
          {
            evenementId: id,
            titre: 'Gala de clôture',
            montant: 12_000,
            nombre: 2,
          },
        ],
      });
    });

    it('filtre les dons d’un événement', async () => {
      const id = await evenementPublie();
      await recevoir({ ...GENERAL, anonyme: true });
      await recevoir({
        destination: 'EVENEMENT',
        evenementId: id,
        montant: 5000,
        anonyme: true,
      });

      const reponse = await request(app.getHttpServer())
        .get(DONS)
        .query({ evenementId: id })
        .set(exploitation.entetes)
        .expect(200);

      expect((reponse.body as { meta: { total: number } }).meta.total).toBe(1);
    });

    it('exporte en CSV, avec « Anonyme » pour un don anonyme', async () => {
      await recevoir({ ...GENERAL, anonyme: true });
      await recevoir({
        ...GENERAL,
        anonyme: false,
        typeDonateur: TypeDonateur.ENTREPRISE,
        raisonSociale: 'Brasseries du Cameroun',
        email: 'dons@brasseries.cm',
      });

      const reponse = await request(app.getHttpServer())
        .get(`${DONS}/export`)
        .set(exploitation.entetes)
        .expect(200);

      expect(reponse.headers['content-type']).toContain('text/csv');
      expect(reponse.text).toContain('Anonyme');
      expect(reponse.text).toContain('Brasseries du Cameroun');
      expect(reponse.text).toContain('Comité en général');
    });
  });
});
