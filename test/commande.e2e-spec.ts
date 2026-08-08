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
import {
  Commande,
  StatutCommande,
} from './../src/modules/commande/entities/commande.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import {
  MethodePaiement,
  StatutPaiement,
} from './../src/modules/paiement/enums/paiement.enum';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const PRODUITS = '/api/v1/produits';
const COMMANDES = '/api/v1/commandes';
const WEBHOOK = '/api/v1/webhooks/fapshi';

/** Secret par defaut de la passerelle factice, impose par setup-e2e. */
const SECRET_WEBHOOK = 'secret-de-developpement';
const ANNEE_ACTIVE = 2027;

/** Numéros du bac à sable Fapshi, repris par la passerelle factice. */
const PAIEMENT_ACCEPTE = '+237670000000';
const PAIEMENT_EN_ATTENTE = '+237677123456';
const PAIEMENT_REFUSE = '+237670000001';

describe('Commandes (e2e)', () => {
  let app: INestApplication<App>;
  let produits: Repository<Produit>;
  let commandes: Repository<Commande>;
  let generations: Repository<Generation>;

  let admin: CompteDeTest;
  let finissant: CompteDeTest;
  let autre: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBillet: jest.fn().mockResolvedValue(undefined),
  };

  const creerProduit = async (
    surcharge: Record<string, unknown> = {},
  ): Promise<string> => {
    const reponse = await request(app.getHttpServer())
      .post(PRODUITS)
      .set(admin.entetes)
      .send({
        nom: 'Sweat capuche promo',
        description: 'Sweat brodé aux couleurs de la promotion.',
        prixCampus: 10_000,
        prixExterne: 12_000,
        stock: 5,
        ...surcharge,
      })
      .expect(201);

    return (reponse.body as { id: string }).id;
  };

  const commander = (
    lignes: Record<string, unknown>[],
    compte: CompteDeTest = finissant,
    telephone = PAIEMENT_ACCEPTE,
  ) =>
    request(app.getHttpServer())
      .post(COMMANDES)
      .set(compte.entetes)
      .send({ lignes, methodePaiement: MethodePaiement.MTN_MOMO, telephone });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue(faussaireMail)
      .compile();

    // rawBody : le controleur de webhook exige le corps brut, comme en
    // production. Sans lui, la notification echoue avant tout traitement.
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

    produits = app.get(getRepositoryToken(Produit));
    commandes = app.get(getRepositoryToken(Commande));
    generations = app.get(getRepositoryToken(Generation));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await commandes.createQueryBuilder().delete().execute();
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
    autre = await creerCompteAuthentifie(app, { promotion: ANNEE_ACTIVE });
  });

  afterAll(async () => {
    await commandes.createQueryBuilder().delete().execute();
    await produits.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('création', () => {
    it('calcule le total côté serveur, au tarif du demandeur', async () => {
      // Un finissant paie le tarif campus : 2 × 10 000, jamais un montant
      // envoyé par le client.
      const id = await creerProduit();

      const reponse = await commander([{ produitId: id, quantite: 2 }]).expect(
        201,
      );

      expect(reponse.body).toMatchObject({ total: 20_000 });
    });

    it('fige le prix unitaire dans la ligne', async () => {
      const id = await creerProduit();
      const reponse = await commander([{ produitId: id, quantite: 1 }]).expect(
        201,
      );
      const commandeId = (reponse.body as { id: string }).id;

      // Le tarif du produit évolue après coup : la commande ne bouge pas.
      await request(app.getHttpServer())
        .patch(`${PRODUITS}/${id}`)
        .set(admin.entetes)
        .send({ prixCampus: 99_000 })
        .expect(200);

      const relue = await request(app.getHttpServer())
        .get(`${COMMANDES}/${commandeId}`)
        .set(finissant.entetes)
        .expect(200);

      expect((relue.body as { total: number }).total).toBe(10_000);
      expect(
        (relue.body as { lignes: { prix: number }[] }).lignes[0].prix,
      ).toBe(10_000);
    });

    it('décrémente le stock', async () => {
      const id = await creerProduit({ stock: 5 });

      await commander([{ produitId: id, quantite: 2 }]).expect(201);

      await expect(produits.findOneByOrFail({ id })).resolves.toMatchObject({
        stock: 3,
      });
    });

    it('refuse un panier vide', async () => {
      await commander([]).expect(400);
    });

    it('refuse une quantité supérieure au stock', async () => {
      const id = await creerProduit({ stock: 2 });

      await commander([{ produitId: id, quantite: 3 }]).expect(409);
      await expect(produits.findOneByOrFail({ id })).resolves.toMatchObject({
        stock: 2,
      });
    });

    it('exige une taille quand le produit en propose', async () => {
      const id = await creerProduit({ tailles: ['S', 'M', 'L'] });

      await commander([{ produitId: id, quantite: 1 }]).expect(400);
    });

    it('refuse une taille que le produit ne propose pas', async () => {
      const id = await creerProduit({ tailles: ['S', 'M'] });

      await commander([{ produitId: id, quantite: 1, taille: 'XXL' }]).expect(
        400,
      );
    });

    it('rend le stock quand une ligne suivante échoue', async () => {
      // La première ligne réserve, la seconde échoue : rien ne doit rester
      // immobilisé, et aucune commande orpheline ne doit subsister.
      const disponible = await creerProduit({ stock: 5 });
      const insuffisant = await creerProduit({ stock: 1 });

      await commander([
        { produitId: disponible, quantite: 2 },
        { produitId: insuffisant, quantite: 5 },
      ]).expect(409);

      await expect(
        produits.findOneByOrFail({ id: disponible }),
      ).resolves.toMatchObject({ stock: 5 });
      await expect(commandes.count()).resolves.toBe(0);
    });
  });

  describe('survente', () => {
    it('ne laisse pas deux commandes simultanées vider le même stock', async () => {
      // Le cœur du sujet : deux commandes de 3 sur un stock de 4.
      const id = await creerProduit({ stock: 4 });

      const reponses = await Promise.all([
        commander([{ produitId: id, quantite: 3 }], finissant),
        commander([{ produitId: id, quantite: 3 }], autre),
      ]);

      const acceptees = reponses.filter((r) => r.status === 201);
      expect(acceptees).toHaveLength(1);

      await expect(produits.findOneByOrFail({ id })).resolves.toMatchObject({
        stock: 1,
      });
    });
  });

  describe('cloisonnement', () => {
    it('ne montre que ses propres commandes', async () => {
      const id = await creerProduit();
      await commander([{ produitId: id, quantite: 1 }], finissant).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(COMMANDES)
        .set(autre.entetes)
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(0);
    });

    it('refuse la lecture de la commande d’autrui', async () => {
      const id = await creerProduit();
      const reponse = await commander(
        [{ produitId: id, quantite: 1 }],
        finissant,
      ).expect(201);
      const commandeId = (reponse.body as { id: string }).id;

      await request(app.getHttpServer())
        .get(`${COMMANDES}/${commandeId}`)
        .set(autre.entetes)
        .expect(404);
    });

    it('refuse la liste complète à un étudiant', async () => {
      await request(app.getHttpServer())
        .get(`${COMMANDES}/toutes`)
        .set(finissant.entetes)
        .expect(403);
    });
  });

  describe('paiement', () => {
    /** Notification au format de la passerelle factice. */
    const notifier = (reference: string, statut: StatutPaiement) =>
      request(app.getHttpServer())
        .post(WEBHOOK)
        .set('Content-Type', 'application/json')
        .set('x-wh-secret', SECRET_WEBHOOK)
        .send(
          JSON.stringify({ reference, referenceExterne: 'trx_simule', statut }),
        );

    /** Commande laissee en attente de paiement. */
    const commandeEnAttente = async (
      stock = 5,
    ): Promise<{ id: string; produitId: string }> => {
      const produitId = await creerProduit({ stock });
      const reponse = await commander(
        [{ produitId, quantite: 2 }],
        finissant,
        PAIEMENT_EN_ATTENTE,
      ).expect(201);

      return { id: (reponse.body as { id: string }).id, produitId };
    };

    it('confirme la commande sur notification du prestataire', async () => {
      // Le webhook doit aiguiller vers la boutique et non vers la
      // billetterie : sans cela, il chercherait un billet qu'il ne trouverait
      // pas, et la commande resterait en attente indefiniment.
      const { id } = await commandeEnAttente();

      await notifier(id, StatutPaiement.COMPLETE).expect(200);

      await expect(commandes.findOneByOrFail({ id })).resolves.toMatchObject({
        statut: StatutCommande.PAYEE,
        statutPaiement: StatutPaiement.COMPLETE,
      });
    });

    it('ne confirme qu’une fois une notification repetee', async () => {
      const { id } = await commandeEnAttente();

      await notifier(id, StatutPaiement.COMPLETE).expect(200);
      const second = await notifier(id, StatutPaiement.COMPLETE).expect(200);

      expect(second.body).toEqual({ recu: true, traite: false });
    });

    it('annule et rend le stock sur un refus', async () => {
      const { id, produitId } = await commandeEnAttente(5);

      await expect(
        produits.findOneByOrFail({ id: produitId }),
      ).resolves.toMatchObject({ stock: 3 });

      await notifier(id, StatutPaiement.ECHOUE).expect(200);

      await expect(commandes.findOneByOrFail({ id })).resolves.toMatchObject({
        statut: StatutCommande.ANNULEE,
        statutPaiement: StatutPaiement.ECHOUE,
      });
      await expect(
        produits.findOneByOrFail({ id: produitId }),
      ).resolves.toMatchObject({ stock: 5 });
    });

    it('ne laisse ni commande ni stock immobilise quand le paiement est refuse', async () => {
      // Refus des l'appel : tout doit etre defait, sans quoi une commande
      // orpheline resterait visible et le stock bloque.
      const produitId = await creerProduit({ stock: 4 });

      await commander(
        [{ produitId, quantite: 2 }],
        finissant,
        PAIEMENT_REFUSE,
      ).expect(400);

      await expect(commandes.count()).resolves.toBe(0);
      await expect(
        produits.findOneByOrFail({ id: produitId }),
      ).resolves.toMatchObject({ stock: 4 });
    });
  });

  describe('administration', () => {
    it('liste toutes les commandes, tous comptes confondus', async () => {
      const produitId = await creerProduit();
      await commander([{ produitId, quantite: 1 }], finissant).expect(201);
      await commander([{ produitId, quantite: 1 }], autre).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${COMMANDES}/toutes`)
        .set(admin.entetes)
        .expect(200);

      expect((reponse.body as { meta: { total: number } }).meta.total).toBe(2);
    });

    it('filtre par statut', async () => {
      const produitId = await creerProduit();
      await commander([{ produitId, quantite: 1 }], finissant).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${COMMANDES}/toutes`)
        .query({ statut: StatutCommande.ANNULEE })
        .set(admin.entetes)
        .expect(200);

      expect((reponse.body as { meta: { total: number } }).meta.total).toBe(0);
    });
  });

  describe('workflow', () => {
    const commandePayee = async (): Promise<string> => {
      const id = await creerProduit();
      const reponse = await commander([{ produitId: id, quantite: 1 }]).expect(
        201,
      );

      return (reponse.body as { id: string }).id;
    };

    it('suit le parcours payée → prête → retirée', async () => {
      const id = await commandePayee();

      const prete = await request(app.getHttpServer())
        .patch(`${COMMANDES}/${id}/prete`)
        .set(admin.entetes)
        .send({ instructions: 'Bureau du COCFET, 10h-16h.' })
        .expect(200);
      expect(prete.body).toMatchObject({ statut: StatutCommande.PRETE });

      const retiree = await request(app.getHttpServer())
        .patch(`${COMMANDES}/${id}/retiree`)
        .set(admin.entetes)
        .expect(200);
      expect(retiree.body).toMatchObject({ statut: StatutCommande.RETIREE });
    });

    it('refuse de préparer une commande non réglée', async () => {
      // Préparer sans encaisser reviendrait à livrer gratuitement.
      const produitId = await creerProduit();
      const reponse = await commander(
        [{ produitId, quantite: 1 }],
        finissant,
        PAIEMENT_EN_ATTENTE,
      ).expect(201);
      const id = (reponse.body as { id: string }).id;

      await request(app.getHttpServer())
        .patch(`${COMMANDES}/${id}/prete`)
        .set(admin.entetes)
        .send({})
        .expect(409);
    });

    it('refuse de constater un retrait avant préparation', async () => {
      const id = await commandePayee();

      await request(app.getHttpServer())
        .patch(`${COMMANDES}/${id}/retiree`)
        .set(admin.entetes)
        .expect(409);
    });

    it('restitue le stock à l’annulation', async () => {
      const produitId = await creerProduit({ stock: 5 });
      const reponse = await commander([{ produitId, quantite: 2 }]).expect(201);
      const id = (reponse.body as { id: string }).id;

      await expect(
        produits.findOneByOrFail({ id: produitId }),
      ).resolves.toMatchObject({ stock: 3 });

      await request(app.getHttpServer())
        .delete(`${COMMANDES}/${id}`)
        .set(finissant.entetes)
        .expect(204);

      await expect(
        produits.findOneByOrFail({ id: produitId }),
      ).resolves.toMatchObject({ stock: 5 });
    });

    it('reste sans effet sur une commande deja annulee', async () => {
      const produitId = await creerProduit({ stock: 5 });
      const reponse = await commander([{ produitId, quantite: 2 }]).expect(201);
      const id = (reponse.body as { id: string }).id;

      const annuler = () =>
        request(app.getHttpServer())
          .delete(`${COMMANDES}/${id}`)
          .set(finissant.entetes)
          .expect(204);

      await annuler();
      // Le second appel ne doit pas rendre le stock une seconde fois.
      await annuler();

      await expect(
        produits.findOneByOrFail({ id: produitId }),
      ).resolves.toMatchObject({ stock: 5 });
    });

    it('refuse d’annuler une commande déjà retirée', async () => {
      const id = await commandePayee();

      await request(app.getHttpServer())
        .patch(`${COMMANDES}/${id}/prete`)
        .set(admin.entetes)
        .send({})
        .expect(200);
      await request(app.getHttpServer())
        .patch(`${COMMANDES}/${id}/retiree`)
        .set(admin.entetes)
        .expect(200);

      await request(app.getHttpServer())
        .delete(`${COMMANDES}/${id}`)
        .set(finissant.entetes)
        .expect(409);
    });
  });
});
