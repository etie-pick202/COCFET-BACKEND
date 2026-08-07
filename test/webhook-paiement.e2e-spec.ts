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
import { Notification } from './../src/modules/notification/entities/notification.entity';
import { PasserellePaiementFactice } from './../src/modules/paiement/adaptateurs/passerelle-paiement-factice';
import { Transaction } from './../src/modules/paiement/entities/transaction.entity';
import {
  MethodePaiement,
  StatutPaiement,
} from './../src/modules/paiement/enums/paiement.enum';
import { PASSERELLE_PAIEMENT } from './../src/modules/paiement/ports/passerelle-paiement';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const WEBHOOK = '/api/v1/webhooks/notchpay';
const EVENEMENTS = '/api/v1/evenements';
const ANNEE_ACTIVE = 2027;

/**
 * Notification de paiement, de bout en bout.
 *
 * Deux garanties se jouent ici, et aucune ne se vérifie autrement qu'en
 * traversant la pile HTTP complète : la signature porte sur les **octets
 * exacts** reçus — un corps resérialisé ne correspondrait plus — et le
 * prestataire renvoie délibérément la même notification plusieurs fois.
 */
describe('Webhook de paiement (e2e)', () => {
  let app: INestApplication<App>;
  let passerelle: PasserellePaiementFactice;
  let inscriptions: Repository<Inscription>;
  let transactions: Repository<Transaction>;
  let evenements: Repository<Evenement>;
  let generations: Repository<Generation>;
  let notifications: Repository<Notification>;

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

  /** Numéro finissant par 1 : la passerelle factice laisse en attente. */
  const TELEPHONE_EN_ATTENTE = '+237699000001';

  /**
   * Notification au format de la passerelle factice, qui est celle branchée
   * ici : le format NotchPay est éprouvé séparément, par les tests unitaires
   * de son adaptateur. Ce fichier vérifie notre chaîne — signature,
   * dédoublonnage, confirmation — indépendamment du prestataire.
   */
  const notifier = (reference: string, statut = StatutPaiement.COMPLETE) => {
    const corps = Buffer.from(
      JSON.stringify({ reference, referenceExterne: 'trx_simule', statut }),
    );
    return { corps, signature: passerelle.signer(corps) };
  };

  /** Crée un événement payant et une inscription restée en attente. */
  const inscriptionEnAttente = async (): Promise<string> => {
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
        prixExterne: 5000,
      })
      .expect(201);

    const id = (cree.body as { id: string }).id;
    await request(app.getHttpServer())
      .post(`${EVENEMENTS}/${id}/publier`)
      .set(admin.entetes)
      .expect(201);

    const inscription = await request(app.getHttpServer())
      .post(`${EVENEMENTS}/${id}/inscription`)
      .set(etudiant.entetes)
      .send({
        methodePaiement: MethodePaiement.MTN_MOMO,
        telephone: TELEPHONE_EN_ATTENTE,
      })
      .expect(201);

    const billet = inscription.body as { statut: string; codeBillet: string };
    expect(billet.statut).toBe(StatutInscription.EN_ATTENTE);

    return billet.codeBillet;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue(faussaireMail)
      .compile();

    // rawBody : sans lui, le corps arrive déjà désérialisé et la signature ne
    // peut plus être vérifiée. C'est exactement la configuration de main.ts.
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

    passerelle = app.get(PASSERELLE_PAIEMENT);
    inscriptions = app.get(getRepositoryToken(Inscription));
    transactions = app.get(getRepositoryToken(Transaction));
    evenements = app.get(getRepositoryToken(Evenement));
    generations = app.get(getRepositoryToken(Generation));
    notifications = app.get(getRepositoryToken(Notification));
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
    etudiant = await creerCompteAuthentifie(app, { promotion: ANNEE_ACTIVE });
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

  describe('signature', () => {
    it('refuse une notification non signée', async () => {
      // Sans ce contrôle, n'importe qui pourrait déclarer un billet payé.
      const code = await inscriptionEnAttente();
      const { corps } = notifier(code);

      await request(app.getHttpServer())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .send(corps.toString('utf8'))
        .expect(400);

      await expect(
        inscriptions.findOne({ where: { codeBillet: code } }),
      ).resolves.toMatchObject({ statut: StatutInscription.EN_ATTENTE });
    });

    it('refuse un corps modifié après signature', async () => {
      const code = await inscriptionEnAttente();
      const legitime = notifier(code, StatutPaiement.ECHOUE);
      const falsifie = notifier(code, StatutPaiement.COMPLETE);

      await request(app.getHttpServer())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .set('x-notch-signature', legitime.signature)
        .send(falsifie.corps.toString('utf8'))
        .expect(400);

      await expect(
        inscriptions.findOne({ where: { codeBillet: code } }),
      ).resolves.toMatchObject({ statut: StatutInscription.EN_ATTENTE });
    });

    it('n’est pas protégée par un jeton — la signature en tient lieu', async () => {
      // L'appelant est le prestataire, qui n'a pas de compte chez nous.
      const code = await inscriptionEnAttente();
      const { corps, signature } = notifier(code);

      await request(app.getHttpServer())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .set('x-notch-signature', signature)
        .send(corps.toString('utf8'))
        .expect(200);
    });
  });

  describe('confirmation', () => {
    it('confirme le billet et prévient la personne', async () => {
      const code = await inscriptionEnAttente();
      const { corps, signature } = notifier(code);

      const reponse = await request(app.getHttpServer())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .set('x-notch-signature', signature)
        .send(corps.toString('utf8'))
        .expect(200);

      expect(reponse.body).toEqual({ recu: true, traite: true });

      await expect(
        inscriptions.findOne({ where: { codeBillet: code } }),
      ).resolves.toMatchObject({
        statut: StatutInscription.CONFIRMEE,
        statutPaiement: StatutPaiement.COMPLETE,
      });

      const recues = await notifications.find();
      expect(recues.some((n) => n.titre.includes('Paiement confirmé'))).toBe(
        true,
      );
    });

    it('ouvre une transaction dès l’inscription, avant le webhook', async () => {
      // Si la notification arrive pendant que nous attendons encore la réponse
      // du prestataire, elle doit trouver une ligne à mettre à jour.
      const code = await inscriptionEnAttente();

      await expect(
        transactions.findOne({ where: { reference: code } }),
      ).resolves.toMatchObject({ statut: StatutPaiement.EN_ATTENTE });
    });
  });

  describe('rejeu', () => {
    it('ne traite qu’une fois une notification répétée', async () => {
      // Le prestataire renvoie délibérément la même notification : c'est son
      // mécanisme de livraison, pas un défaut.
      const code = await inscriptionEnAttente();
      const { corps, signature } = notifier(code);

      const premier = await request(app.getHttpServer())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .set('x-notch-signature', signature)
        .send(corps.toString('utf8'))
        .expect(200);
      const second = await request(app.getHttpServer())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .set('x-notch-signature', signature)
        .send(corps.toString('utf8'))
        .expect(200);

      expect(premier.body).toEqual({ recu: true, traite: true });
      // 200 et non une erreur : un code d'échec relancerait les tentatives du
      // prestataire pour une notification déjà prise en compte.
      expect(second.body).toEqual({ recu: true, traite: false });

      const confirmations = (await notifications.find()).filter((n) =>
        n.titre.includes('Paiement confirmé'),
      );
      expect(confirmations).toHaveLength(1);
    });

    it('résiste à deux notifications simultanées', async () => {
      const code = await inscriptionEnAttente();
      const { corps, signature } = notifier(code);

      const envoyer = () =>
        request(app.getHttpServer())
          .post(WEBHOOK)
          .set('Content-Type', 'application/json')
          .set('x-notch-signature', signature)
          .send(corps.toString('utf8'));

      const resultats = await Promise.all([envoyer(), envoyer()]);

      const traites = resultats.filter(
        (r) => (r.body as { traite: boolean }).traite,
      );
      expect(traites).toHaveLength(1);
    });
  });

  describe('référence inconnue', () => {
    it('accuse réception sans rien confirmer', async () => {
      // Une référence que nous ne connaissons pas ne doit pas faire échouer la
      // requête : le prestataire réessaierait indéfiniment.
      const { corps, signature } = notifier('COCFET-INEXISTANT');

      const reponse = await request(app.getHttpServer())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .set('x-notch-signature', signature)
        .send(corps.toString('utf8'))
        .expect(200);

      expect(reponse.body).toEqual({ recu: true, traite: false });
    });
  });
});
