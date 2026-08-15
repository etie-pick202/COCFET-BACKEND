import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { Produit } from './../src/modules/boutique/entities/produit.entity';
import { MembreBureau } from './../src/modules/bureau/entities/membre-bureau.entity';
import { PosteBureau } from './../src/modules/bureau/entities/poste-bureau.entity';
import {
  Commande,
  StatutCommande,
} from './../src/modules/commande/entities/commande.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { JustificatifPaiement } from './../src/modules/justificatif/entities/justificatif-paiement.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { MethodePaiement } from './../src/modules/paiement/enums/paiement.enum';
import { Transaction } from './../src/modules/paiement/entities/transaction.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const JUSTIFS = '/api/v1/justificatifs';
const COMMANDES = '/api/v1/commandes';
const PRODUITS = '/api/v1/produits';
const ANNEE = 2027;

/** Le numéro que la passerelle factice laisse en attente de règlement. */
const PAIEMENT_EN_ATTENTE = '+237677123456';

const CLE = 'justificatifs/capture-momo.png';

/**
 * Preuves de paiement remises hors de la plateforme.
 *
 * Ce que seul un banc de bout en bout établit : **valider une capture produit
 * exactement les mêmes effets qu'un paiement en ligne**. C'est toute la raison
 * d'avoir factorisé la répercussion — un paiement reconnu à la main ne doit
 * pas délivrer moins qu'un paiement encaissé par le prestataire.
 */
describe('Justificatifs de paiement (e2e)', () => {
  let app: INestApplication<App>;
  let commandes: Repository<Commande>;
  let produits: Repository<Produit>;
  let generations: Repository<Generation>;
  let postes: Repository<PosteBureau>;
  let membres: Repository<MembreBureau>;
  let transactions: Repository<Transaction>;
  let justificatifs: Repository<JustificatifPaiement>;

  let admin: CompteDeTest;
  let payeur: CompteDeTest;
  let tresoriere: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBienvenueAuBureau: jest.fn().mockResolvedValue(undefined),
  };

  /** Crée une commande laissée en attente de règlement. */
  const commandeEnAttente = async (): Promise<string> => {
    const produit = (
      await request(app.getHttpServer())
        .post(PRODUITS)
        .set(admin.entetes)
        .send({
          nom: 'Sweat promo',
          description: 'Sweat brodé.',
          prixCampus: 5000,
          prixExterne: 6000,
          stock: 5,
        })
        .expect(201)
    ).body as { id: string };

    const commande = (
      await request(app.getHttpServer())
        .post(COMMANDES)
        .set(payeur.entetes)
        .send({
          lignes: [{ produitId: produit.id, quantite: 1 }],
          methodePaiement: MethodePaiement.MTN_MOMO,
          telephone: PAIEMENT_EN_ATTENTE,
        })
        .expect(201)
    ).body as { id: string };

    return commande.id;
  };

  const deposer = (
    reference: string,
    montantDeclare = 5000,
    compte: CompteDeTest = payeur,
  ) =>
    request(app.getHttpServer())
      .post(JUSTIFS)
      .set(compte.entetes)
      .send({ reference, cle: CLE, montantDeclare });

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

    commandes = app.get(getRepositoryToken(Commande));
    produits = app.get(getRepositoryToken(Produit));
    generations = app.get(getRepositoryToken(Generation));
    postes = app.get(getRepositoryToken(PosteBureau));
    membres = app.get(getRepositoryToken(MembreBureau));
    transactions = app.get(getRepositoryToken(Transaction));
    justificatifs = app.get(getRepositoryToken(JustificatifPaiement));
  });

  const purger = async (): Promise<void> => {
    await justificatifs.createQueryBuilder().delete().execute();
    await transactions.createQueryBuilder().delete().execute();
    await commandes.createQueryBuilder().delete().execute();
    await produits.createQueryBuilder().delete().execute();
    await membres.createQueryBuilder().delete().execute();
    await postes.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await purger();

    const generation = await generations.save(
      generations.create({ annee: ANNEE, nom: 'ATLAS', isActive: true }),
    );

    admin = await creerCompteAuthentifie(app, {
      role: Role.ADMIN,
      promotion: null,
    });
    payeur = await creerCompteAuthentifie(app, { promotion: ANNEE });
    tresoriere = await creerCompteAuthentifie(app, { promotion: ANNEE });

    // La trésorière tient son droit d'un **poste**, jamais de son rôle : c'est
    // ce qui fait survivre le privilège à une passation.
    const poste = await postes.save(
      postes.create({ nom: 'Trésorière', accedeTresorerie: true }),
    );
    await membres.save(
      membres.create({ generation, poste, user: tresoriere.user }),
    );
  });

  afterAll(async () => {
    await purger();
    await app.close();
  });

  describe('dépôt', () => {
    it('accepte la preuve du titulaire du règlement', async () => {
      const reference = await commandeEnAttente();

      const reponse = await deposer(reference).expect(201);

      expect(reponse.body).toMatchObject({
        reference,
        montantDeclare: 5000,
        statut: 'EN_ATTENTE',
      });
    });

    it('refuse une clé qui ne vient pas du bon usage', async () => {
      // Sans ce contrôle, le CV d'un finissant ou le logo du mandat pourrait
      // être présenté comme preuve, et validé par quelqu'un qui regarde vite.
      const reference = await commandeEnAttente();

      await request(app.getHttpServer())
        .post(JUSTIFS)
        .set(payeur.entetes)
        .send({ reference, cle: 'cv/dossier.pdf', montantDeclare: 5000 })
        .expect(400);
    });

    it('refuse la preuve du règlement d’autrui', async () => {
      const reference = await commandeEnAttente();

      // 404 et non 403 : répondre « interdit » confirmerait que cette
      // référence existe.
      await deposer(reference, 5000, tresoriere).expect(404);
    });

    it('n’accepte qu’une preuve en attente à la fois', async () => {
      // Sans cette limite, on noie la trésorerie sous les captures d'un même
      // règlement jusqu'à ce qu'elle en valide une sans regarder.
      const reference = await commandeEnAttente();

      await deposer(reference).expect(201);
      await deposer(reference).expect(409);
    });
  });

  describe('décision', () => {
    it('reconnaît le paiement et confirme la commande', async () => {
      // Le point central : la validation doit produire exactement ce que
      // produirait une notification du prestataire.
      const reference = await commandeEnAttente();
      const { id } = (await deposer(reference).expect(201)).body as {
        id: string;
      };

      await request(app.getHttpServer())
        .post(`${JUSTIFS}/${id}/valider`)
        .set(tresoriere.entetes)
        .send({ montantRecu: 5000 })
        .expect(201);

      await expect(
        commandes.findOneByOrFail({ id: reference }),
      ).resolves.toMatchObject({ statut: StatutCommande.PAYEE });
    });

    it('refuse la décision à qui n’accède pas aux finances', async () => {
      const reference = await commandeEnAttente();
      const { id } = (await deposer(reference).expect(201)).body as {
        id: string;
      };

      // L'administration de la plateforme ne donne pas accès aux comptes :
      // publier des événements et reconnaître un paiement sont deux métiers.
      await request(app.getHttpServer())
        .post(`${JUSTIFS}/${id}/valider`)
        .set(admin.entetes)
        .send({ montantRecu: 5000 })
        .expect(403);
    });

    it('laisse le règlement en attente après un refus', async () => {
      // Un refus dit que cette image ne prouve rien, pas que l'argent n'a pas
      // été versé : la personne doit pouvoir en déposer une autre.
      const reference = await commandeEnAttente();
      const { id } = (await deposer(reference).expect(201)).body as {
        id: string;
      };

      await request(app.getHttpServer())
        .post(`${JUSTIFS}/${id}/refuser`)
        .set(tresoriere.entetes)
        .send({ motif: 'La capture ne montre ni le montant ni la date.' })
        .expect(201);

      await expect(
        commandes.findOneByOrFail({ id: reference }),
      ).resolves.toMatchObject({ statut: StatutCommande.EN_ATTENTE });

      await deposer(reference).expect(201);
    });

    it('consigne le montant recu et celui qui detient l’argent', async () => {
      // « montantRecu » n'est pas « montantDeclare » : le declare est ce que
      // le payeur affirme, le recu ce que la tresorerie certifie. Seul le
      // second entre en comptabilite, et l'ecart doit rester visible.
      const reference = await commandeEnAttente();
      const { id } = (await deposer(reference, 9000).expect(201)).body as {
        id: string;
      };

      const reponse = await request(app.getHttpServer())
        .post(`${JUSTIFS}/${id}/valider`)
        .set(tresoriere.entetes)
        .send({ montantRecu: 5000 })
        .expect(201);

      const corps = reponse.body as {
        montantDeclare: number;
        montantRecu: number;
        recuPar: { id: string } | null;
        validateur: { id: string } | null;
      };

      expect(corps.montantDeclare).toBe(9000);
      expect(corps.montantRecu).toBe(5000);
      // A defaut de destinataire designe, le validateur est repute avoir recu
      // l'argent : laisser le champ vide rendrait l'encaisse incalculable.
      expect(corps.recuPar?.id).toBe(tresoriere.user.id);
      expect(corps.validateur?.id).toBe(tresoriere.user.id);
    });

    it('ne rejuge pas une preuve déjà tranchée', async () => {
      const reference = await commandeEnAttente();
      const { id } = (await deposer(reference).expect(201)).body as {
        id: string;
      };

      await request(app.getHttpServer())
        .post(`${JUSTIFS}/${id}/valider`)
        .set(tresoriere.entetes)
        .send({ montantRecu: 5000 })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${JUSTIFS}/${id}/valider`)
        .set(tresoriere.entetes)
        .send({ montantRecu: 5000 })
        .expect(400);
    });
  });

  describe('historique', () => {
    it('rend chaque pièce avec son titulaire', async () => {
      const reference = await commandeEnAttente();
      await deposer(reference).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(JUSTIFS)
        .set(tresoriere.entetes)
        .expect(200);

      const pieces = reponse.body as { user: { id: string } }[];
      expect(pieces).toHaveLength(1);
      expect(pieces[0].user.id).toBe(payeur.user.id);
    });

    it('est fermé à qui n’accède pas aux finances', async () => {
      await request(app.getHttpServer())
        .get(JUSTIFS)
        .set(payeur.entetes)
        .expect(403);
    });

    it('laisse chacun consulter les siennes', async () => {
      const reference = await commandeEnAttente();
      await deposer(reference).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${JUSTIFS}/moi`)
        .set(payeur.entetes)
        .expect(200);

      expect(reponse.body as unknown[]).toHaveLength(1);
    });
  });
});
