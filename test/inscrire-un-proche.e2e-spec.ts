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
  TypeEvenement,
} from './../src/modules/evenement/entities/evenement.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { AlerteTresorerieService } from './../src/modules/notification/alerte-tresorerie.service';
import { Notification } from './../src/modules/notification/entities/notification.entity';
import { Transaction } from './../src/modules/paiement/entities/transaction.entity';
import {
  MethodePaiement,
  StatutPaiement,
} from './../src/modules/paiement/enums/paiement.enum';
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  emailExterne,
  purgerUtilisateurs,
} from './utils/authentification';

const EVENEMENTS = '/api/v1/evenements';
const WEBHOOK = '/api/v1/webhooks/fapshi';
const SECRET_WEBHOOK = 'secret-de-developpement';
const ANNEE_ACTIVE = 2027;
/** Numéro hors des listes du bac à sable : le paiement reste en attente. */
const TELEPHONE_EN_ATTENTE = '+237677123456';

/**
 * Inscrire des proches et payer pour plusieurs, de bout en bout : la recherche
 * d'une personne, un billet offert, un paiement groupé, et ce que chacun voit.
 */
describe('Inscrire un proche (e2e)', () => {
  let app: INestApplication<App>;
  let inscriptions: Repository<Inscription>;
  let transactions: Repository<Transaction>;
  let evenements: Repository<Evenement>;
  let generations: Repository<Generation>;
  let notifications: Repository<Notification>;
  let users: Repository<User>;

  let admin: CompteDeTest;
  let payeur: CompteDeTest;
  let amie: CompteDeTest;
  let ami: CompteDeTest;
  let externe: CompteDeTest;
  let encaissement: jest.SpyInstance;
  let offertAnnule: jest.SpyInstance;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBillet: jest.fn().mockResolvedValue(undefined),
  };

  const PAIEMENT = {
    methodePaiement: MethodePaiement.MTN_MOMO,
    telephone: TELEPHONE_EN_ATTENTE,
  };

  const creerEvenement = async (
    corps: Record<string, unknown> = {},
  ): Promise<string> => {
    const cree = await request(app.getHttpServer())
      .post(EVENEMENTS)
      .set(admin.entetes)
      .send({
        titre: 'Gala payant',
        description: 'Soirée de clôture du mandat.',
        dateDebut: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        lieu: 'Campus UCAC-ICAM',
        type: TypeEvenement.PAYANT,
        prixCampus: 5000,
        prixExterne: 8000,
        ...corps,
      })
      .expect(201);
    const id = (cree.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`${EVENEMENTS}/${id}/publier`)
      .set(admin.entetes)
      .expect(201);
    return id;
  };

  const inscrire = (
    evenementId: string,
    participants: Record<string, unknown>[],
    qui: CompteDeTest = payeur,
  ) =>
    request(app.getHttpServer())
      .post(`${EVENEMENTS}/${evenementId}/inscription-groupe`)
      .set(qui.entetes)
      .send({ participants, ...PAIEMENT });

  const rechercher = (q: string, evenementId?: string, qui = payeur) =>
    request(app.getHttpServer())
      .get('/api/v1/utilisateurs/recherche')
      .query({ q, ...(evenementId ? { evenementId } : {}) })
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

  const de = (compte: CompteDeTest, evenementId: string) =>
    inscriptions.findOneOrFail({
      where: { user: { id: compte.user.id }, evenement: { id: evenementId } },
      relations: { user: true, payeur: true },
    });

  /** La référence sous laquelle un billet se règle : celle du groupe, ou son code. */
  const referenceDe = (billet: Inscription): string =>
    billet.groupePaiement ?? billet.codeBillet;

  const places = async (evenementId: string): Promise<number> =>
    (await evenements.findOneByOrFail({ id: evenementId }))
      .inscriptionsActuelles;

  const titresRecus = async (compte: CompteDeTest): Promise<string[]> =>
    (await notifications.find({ where: { user: { id: compte.user.id } } })).map(
      (n) => n.titre,
    );

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

    inscriptions = app.get(getRepositoryToken(Inscription));
    transactions = app.get(getRepositoryToken(Transaction));
    evenements = app.get(getRepositoryToken(Evenement));
    generations = app.get(getRepositoryToken(Generation));
    notifications = app.get(getRepositoryToken(Notification));
    users = app.get(getRepositoryToken(User));
    const alerte = app.get(AlerteTresorerieService);
    encaissement = jest.spyOn(alerte, 'encaissement');
    offertAnnule = jest.spyOn(alerte, 'billetOffertAnnule');
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await inscriptions.createQueryBuilder().delete().execute();
    await transactions.createQueryBuilder().delete().execute();
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
    payeur = await creerCompteAuthentifie(app, {
      prenom: 'Étienne',
      nom: 'Mayack',
      promotion: ANNEE_ACTIVE,
    });
    amie = await creerCompteAuthentifie(app, {
      prenom: 'Marie',
      nom: 'Dupont',
      promotion: ANNEE_ACTIVE,
    });
    ami = await creerCompteAuthentifie(app, {
      prenom: 'Paul',
      nom: 'Essomba',
      promotion: ANNEE_ACTIVE,
    });
    // Adresse gmail : tarif externe.
    externe = await creerCompteAuthentifie(app, {
      role: Role.VISITOR,
      prenom: 'Aïcha',
      nom: 'Bello',
      email: emailExterne(),
    });
  });

  afterAll(async () => {
    await inscriptions.createQueryBuilder().delete().execute();
    await transactions.createQueryBuilder().delete().execute();
    await notifications.createQueryBuilder().delete().execute();
    await evenements.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('retrouver une personne', () => {
    it('trouve par nom, sans exposer l’adresse', async () => {
      const reponse = await rechercher('dupo').expect(200);

      const trouves = reponse.body as {
        id: string;
        prenom: string;
        emailMasque: string;
      }[];
      expect(trouves).toHaveLength(1);
      expect(trouves[0]).toMatchObject({ id: amie.user.id, prenom: 'Marie' });
      expect(trouves[0].emailMasque).toMatch(/^t\*\*\*@/);
      expect(JSON.stringify(trouves)).not.toContain(amie.user.email);
    });

    it('trouve aussi par adresse email', async () => {
      const reponse = await rechercher(amie.user.email).expect(200);

      expect((reponse.body as { id: string }[])[0].id).toBe(amie.user.id);
    });

    it('ne propose pas la personne qui cherche', async () => {
      const reponse = await rechercher('mayack').expect(200);

      expect(reponse.body).toEqual([]);
    });

    it('écarte les comptes non confirmés ou désactivés', async () => {
      await creerCompteAuthentifie(app, {
        prenom: 'Zoé',
        nom: 'Inconfirmée',
        emailVerifie: false,
      });
      await creerCompteAuthentifie(app, {
        prenom: 'Zoé',
        nom: 'Désactivée',
        isActive: false,
      });

      const reponse = await rechercher('zoé').expect(200);

      expect(reponse.body).toEqual([]);
    });

    it('écarte les personnes déjà inscrites à l’événement', async () => {
      const id = await creerEvenement();
      await inscrire(id, [{ userId: amie.user.id }]).expect(201);

      const reponse = await rechercher('dupont', id).expect(200);

      expect(reponse.body).toEqual([]);
    });

    it('cherche le caractère lui-même, pas un joker', async () => {
      // « % » n'est pas « n'importe quoi » : sinon on aspirerait l'annuaire.
      const reponse = await rechercher('%%%').expect(200);

      expect(reponse.body).toEqual([]);
    });

    it('exige trois caractères et une session', async () => {
      await rechercher('ma').expect(400);
      await request(app.getHttpServer())
        .get('/api/v1/utilisateurs/recherche')
        .query({ q: 'marie' })
        .expect(401);
    });
  });

  describe('retrouver une personne pour un événement', () => {
    it('donne le tarif de chaque personne, pas celui de celui qui paie', async () => {
      const id = await creerEvenement();

      const campus = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}/proches`)
        .query({ q: 'dupont' })
        .set(payeur.entetes)
        .expect(200);
      const hors = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}/proches`)
        .query({ q: 'bello' })
        .set(payeur.entetes)
        .expect(200);

      expect(campus.body).toEqual([
        expect.objectContaining({
          prenom: 'Marie',
          prix: 5000,
          tarifCampus: true,
        }),
      ]);
      expect(hors.body).toEqual([
        expect.objectContaining({
          prenom: 'Aïcha',
          prix: 8000,
          tarifCampus: false,
        }),
      ]);
    });

    it('écarte les personnes déjà inscrites, et exige trois caractères', async () => {
      const id = await creerEvenement();
      await inscrire(id, [{ userId: amie.user.id }]).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}/proches`)
        .query({ q: 'dupont' })
        .set(payeur.entetes)
        .expect(200);
      expect(reponse.body).toEqual([]);

      await request(app.getHttpServer())
        .get(`${EVENEMENTS}/${id}/proches`)
        .query({ q: 'du' })
        .set(payeur.entetes)
        .expect(400);
    });
  });

  describe('offrir un billet', () => {
    it('inscrit le proche à son tarif et mémorise qui paie', async () => {
      const id = await creerEvenement();

      const reponse = await inscrire(id, [{ userId: externe.user.id }]).expect(
        201,
      );

      const billet = await de(externe, id);
      expect(billet.statut).toBe(StatutInscription.EN_ATTENTE);
      // Le tarif du bénéficiaire (externe), pas celui du payeur (campus).
      expect(billet.prix).toBe(8000);
      expect(billet.payeur?.id).toBe(payeur.user.id);

      const corps = reponse.body as {
        reference: string;
        billets: Record<string, unknown>[];
      };
      expect(corps.billets).toHaveLength(1);
      // La référence du paiement ne révèle pas le code d'entrée du proche.
      expect(JSON.stringify(corps)).not.toContain(billet.codeBillet);
      expect(corps.reference).toMatch(/^GRP-/);
    });

    it('débite le payeur, pas le titulaire du billet', async () => {
      const id = await creerEvenement();
      await inscrire(id, [{ userId: amie.user.id }]).expect(201);

      const billet = await de(amie, id);
      const transaction = await transactions.findOneOrFail({
        where: { reference: referenceDe(billet) },
        relations: { user: true },
      });
      expect(transaction.user?.id).toBe(payeur.user.id);
      expect(transaction.montant).toBe(billet.frais.montantTtc);
      expect(await places(id)).toBe(1);
    });

    it('confirme le billet, prévient les deux et envoie le billet au proche', async () => {
      const id = await creerEvenement();
      await inscrire(id, [{ userId: amie.user.id }]).expect(201);
      const billet = await de(amie, id);

      await notifierPaiement(referenceDe(billet), StatutPaiement.COMPLETE);

      await expect(de(amie, id)).resolves.toMatchObject({
        statut: StatutInscription.CONFIRMEE,
      });

      const pourElle = await notifications.find({
        where: { user: { id: amie.user.id } },
      });
      const offert = pourElle.find(
        (n) => n.titre === 'Un billet vous est offert',
      );
      expect(offert?.message).toContain('Étienne Mayack a payé votre billet');

      expect(await titresRecus(payeur)).toContain('Billet payé pour un proche');
      const aQui = (faussaireMail.envoyerBillet.mock.calls as unknown[][]).map(
        (appel) => appel[0],
      );
      expect(aQui).toContain(amie.user.email);
      expect(encaissement).toHaveBeenCalledWith(
        expect.objectContaining({
          payeur: expect.objectContaining({
            id: payeur.user.id,
          }) as unknown,
          objet: expect.stringContaining('Marie Dupont') as string,
        }),
      );
    });

    it('refuse une personne déjà inscrite, en la nommant', async () => {
      const id = await creerEvenement();
      await inscrire(id, [{ userId: amie.user.id }]).expect(201);

      const reponse = await inscrire(id, [{ userId: amie.user.id }]).expect(
        409,
      );

      expect((reponse.body as { message: string }).message).toContain(
        'Marie Dupont',
      );
    });

    it('refuse un compte inconnu, désactivé ou non confirmé', async () => {
      const id = await creerEvenement();
      const inactive = await creerCompteAuthentifie(app, { isActive: false });
      const inconfirmee = await creerCompteAuthentifie(app, {
        emailVerifie: false,
      });

      await inscrire(id, [{ userId: inactive.user.id }]).expect(404);
      await inscrire(id, [{ userId: inconfirmee.user.id }]).expect(404);
      await inscrire(id, [
        { userId: '11111111-1111-4111-8111-111111111111' },
      ]).expect(404);
      expect(await places(id)).toBe(0);
    });

    it('relance le proche pour sa taille quand l’événement en demande une', async () => {
      const id = await creerEvenement({
        options: [
          {
            libelle: 'Taille de T-shirt',
            obligatoire: true,
            choix: [{ valeur: 'M' }, { valeur: 'L' }],
          },
        ],
      });

      // Le payeur doit choisir pour lui, pas pour son amie.
      await inscrire(id, [
        { userId: amie.user.id },
        { reponses: { 'taille-de-t-shirt': 'L' } },
      ]).expect(201);

      await expect(de(amie, id)).resolves.toMatchObject({ reponses: {} });
      await expect(de(payeur, id)).resolves.toMatchObject({
        reponses: { 'taille-de-t-shirt': 'L' },
      });
    });
  });

  describe('payer pour plusieurs en une fois', () => {
    it('règle plusieurs billets d’un seul paiement, chacun à son tarif', async () => {
      const id = await creerEvenement();

      const reponse = await inscrire(id, [
        {},
        { userId: amie.user.id },
        { userId: externe.user.id },
      ]).expect(201);

      const corps = reponse.body as {
        reference: string;
        montantDebite: number;
        billets: { pourMoi: boolean; prix: number }[];
      };
      expect(corps.reference).toMatch(/^GRP-/);
      expect(corps.billets).toHaveLength(3);
      expect(corps.billets.filter((b) => b.pourMoi)).toHaveLength(1);

      const transaction = await transactions.findOneOrFail({
        where: { reference: corps.reference },
      });
      // Une seule transaction, pour la somme de ce que chaque billet doit.
      expect(transaction.montant).toBe(corps.montantDebite);
      expect(await transactions.count()).toBe(1);
      expect(await places(id)).toBe(3);

      const soi = await de(payeur, id);
      expect(soi.payeur).toBeNull();
      expect(soi.prix).toBe(5000);
      expect((await de(externe, id)).prix).toBe(8000);
    });

    it('confirme tous les billets quand le paiement aboutit', async () => {
      const id = await creerEvenement();
      const reponse = await inscrire(id, [
        {},
        { userId: amie.user.id },
        { userId: ami.user.id },
      ]).expect(201);
      const { reference } = reponse.body as { reference: string };

      await notifierPaiement(reference, StatutPaiement.COMPLETE);

      for (const compte of [payeur, amie, ami]) {
        await expect(de(compte, id)).resolves.toMatchObject({
          statut: StatutInscription.CONFIRMEE,
          statutPaiement: StatutPaiement.COMPLETE,
        });
      }
      // Chacun reçoit son billet, à son adresse.
      const destinataires = faussaireMail.envoyerBillet.mock.calls.map(
        (appel: unknown[]) => appel[0],
      );
      expect(destinataires).toEqual(
        expect.arrayContaining([
          payeur.user.email,
          amie.user.email,
          ami.user.email,
        ]),
      );
      expect(await titresRecus(amie)).toContain('Un billet vous est offert');
      expect(await titresRecus(ami)).toContain('Un billet vous est offert');
    });

    it('rend toutes les places et prévient une fois le payeur quand le paiement échoue', async () => {
      const id = await creerEvenement();
      const reponse = await inscrire(id, [
        {},
        { userId: amie.user.id },
        { userId: ami.user.id },
      ]).expect(201);
      const { reference } = reponse.body as { reference: string };
      expect(await places(id)).toBe(3);

      await notifierPaiement(reference, StatutPaiement.ECHOUE);

      expect(await places(id)).toBe(0);
      expect(
        await inscriptions.countBy({ statut: StatutInscription.ANNULEE }),
      ).toBe(3);
      expect(
        (await titresRecus(payeur)).filter((t) => t === 'Paiement non abouti'),
      ).toHaveLength(1);
      // Les proches ne savaient pas qu'on leur offrait un billet.
      expect(await titresRecus(amie)).not.toContain('Paiement non abouti');
    });

    it('ne garde rien quand il manque une place', async () => {
      const id = await creerEvenement({ capaciteMax: 2 });

      await inscrire(id, [
        {},
        { userId: amie.user.id },
        { userId: ami.user.id },
      ]).expect(409);

      expect(await places(id)).toBe(0);
      expect(await inscriptions.count()).toBe(0);
      expect(await transactions.count()).toBe(0);
    });

    it('refuse la même personne deux fois, ou plus de cinq billets', async () => {
      const id = await creerEvenement();

      await inscrire(id, [
        { userId: amie.user.id },
        { userId: amie.user.id },
      ]).expect(400);
      await inscrire(
        id,
        Array.from({ length: 6 }, () => ({ userId: amie.user.id })),
      ).expect(400);
      await inscrire(id, []).expect(400);
      expect(await inscriptions.count()).toBe(0);
    });

    it('inscrit sans paiement quand tout est gratuit', async () => {
      const id = await creerEvenement({
        type: TypeEvenement.GRATUIT,
        prixCampus: undefined,
        prixExterne: undefined,
      });

      const reponse = await inscrire(id, [{}, { userId: amie.user.id }]).expect(
        201,
      );

      expect((reponse.body as { statutPaiement: string }).statutPaiement).toBe(
        StatutPaiement.COMPLETE,
      );
      await expect(de(amie, id)).resolves.toMatchObject({
        statut: StatutInscription.CONFIRMEE,
      });
      expect(await transactions.count()).toBe(0);
      expect(faussaireMail.envoyerBillet).toHaveBeenCalledTimes(2);
    });
  });

  describe('après le paiement', () => {
    const offrir = async (): Promise<{ id: string; code: string }> => {
      const id = await creerEvenement();
      await inscrire(id, [{ userId: amie.user.id }]).expect(201);
      return { id, code: referenceDe(await de(amie, id)) };
    };

    it('empêche le titulaire d’annuler un billet en cours de règlement', async () => {
      const { id } = await offrir();
      const billet = await de(amie, id);

      const reponse = await request(app.getHttpServer())
        .delete(`/api/v1/billets/${billet.id}`)
        .set(amie.entetes)
        .expect(409);

      expect((reponse.body as { message: string }).message).toContain(
        'Étienne Mayack',
      );
      await expect(de(amie, id)).resolves.toMatchObject({
        statut: StatutInscription.EN_ATTENTE,
      });
    });

    it('rembourse le payeur, pas le titulaire, quand le billet est annulé', async () => {
      const { id, code } = await offrir();
      await notifierPaiement(code, StatutPaiement.COMPLETE);
      const billet = await de(amie, id);

      await request(app.getHttpServer())
        .delete(`/api/v1/billets/${billet.id}`)
        .set(amie.entetes)
        .expect(204);

      expect(await titresRecus(payeur)).toContain('Billet offert annulé');
      expect(offertAnnule).toHaveBeenCalledWith(
        expect.objectContaining({ id: payeur.user.id }),
        expect.stringContaining('Marie Dupont') as string,
        expect.any(Number),
      );
    });

    it('liste les billets offerts, sans leurs codes d’entrée', async () => {
      const { id, code } = await offrir();

      const reponse = await request(app.getHttpServer())
        .get('/api/v1/billets/offerts')
        .set(payeur.entetes)
        .expect(200);

      const offerts = reponse.body as {
        evenement: { id: string };
        beneficiaire: { prenom: string };
      }[];
      expect(offerts).toHaveLength(1);
      expect(offerts[0]).toMatchObject({
        evenement: { id },
        beneficiaire: { prenom: 'Marie' },
      });
      expect(JSON.stringify(reponse.body)).not.toContain(code);

      // Le titulaire, lui, n'a rien « offert ».
      const pourElle = await request(app.getHttpServer())
        .get('/api/v1/billets/offerts')
        .set(amie.entetes)
        .expect(200);
      expect(pourElle.body).toEqual([]);
    });

    it('adresse la facture au payeur, et la refuse au titulaire', async () => {
      const { id, code } = await offrir();
      await notifierPaiement(code, StatutPaiement.COMPLETE);
      const billet = await de(amie, id);

      await request(app.getHttpServer())
        .post(`/api/v1/documents/recu-billetterie/${billet.id}`)
        .set(amie.entetes)
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/v1/documents/recu-billetterie/${billet.id}`)
        .set(payeur.entetes)
        .expect(201);
    });

    it('ne laisse pas le payeur lire le billet de son proche', async () => {
      const { id, code } = await offrir();
      await notifierPaiement(code, StatutPaiement.COMPLETE);
      const billet = await de(amie, id);

      // C'est le billet de Marie : son code d'entrée n'est pas à Étienne.
      await request(app.getHttpServer())
        .get(`/api/v1/billets/${billet.id}`)
        .set(payeur.entetes)
        .expect(404);
      await expect(users.count()).resolves.toBeGreaterThan(0);
    });
  });
});
