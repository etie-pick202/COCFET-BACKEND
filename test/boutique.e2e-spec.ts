import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { BoutiqueService } from './../src/modules/boutique/boutique.service';
import {
  CategorieProduit,
  Produit,
  StatutProduit,
} from './../src/modules/boutique/entities/produit.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { Commande } from './../src/modules/commande/entities/commande.entity';
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
  let commandes: Repository<Commande>;
  let generations: Repository<Generation>;
  let boutiqueService: BoutiqueService;

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
    commandes = app.get(getRepositoryToken(Commande));
    generations = app.get(getRepositoryToken(Generation));
    boutiqueService = app.get(BoutiqueService);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Avant les produits : les lignes de commande les referencent en
    // RESTRICT, et les effacer d'abord ferait echouer la purge.
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
    externe = await creerCompteAuthentifie(app, { role: Role.VISITOR });
  });

  afterAll(async () => {
    // Avant les produits : les lignes de commande les referencent en
    // RESTRICT, et les effacer d'abord ferait echouer la purge.
    await commandes.createQueryBuilder().delete().execute();
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

  describe('filtres', () => {
    it('filtre par catégorie', async () => {
      await creerProduit({ categorie: CategorieProduit.VETEMENT }).expect(201);
      await creerProduit({
        nom: 'Porte-clés',
        categorie: CategorieProduit.GOODIES,
      }).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(PRODUITS)
        .query({ categorie: CategorieProduit.VETEMENT })
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });

    it('cherche dans le nom et la description', async () => {
      await creerProduit({ nom: 'Casquette brodée' }).expect(201);
      await creerProduit({ nom: 'Mug isotherme' }).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(PRODUITS)
        .query({ recherche: 'casquette' })
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });

    it('ne garde que le commandable sur demande', async () => {
      await creerProduit({ stock: 0 }).expect(201);
      await creerProduit({ nom: 'En stock', stock: 4 }).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(PRODUITS)
        .query({ disponibleSeulement: 'true' })
        .expect(200);

      const donnees = (reponse.body as { donnees: { nom: string }[] }).donnees;
      expect(donnees).toHaveLength(1);
      expect(donnees[0].nom).toBe('En stock');
    });

    it('laisse l’administration filtrer les retirés', async () => {
      const id = await creerEtRecuperer();
      await request(app.getHttpServer())
        .delete(`${PRODUITS}/${id}`)
        .set(admin.entetes)
        .expect(200);

      const reponse = await request(app.getHttpServer())
        .get(PRODUITS)
        .query({ statut: StatutProduit.RETIRE })
        .set(admin.entetes)
        .expect(200);

      expect((reponse.body as { donnees: unknown[] }).donnees).toHaveLength(1);
    });
  });

  describe('modification', () => {
    it('met à jour les champs modifiables', async () => {
      const id = await creerEtRecuperer();

      const reponse = await request(app.getHttpServer())
        .patch(`${PRODUITS}/${id}`)
        .set(admin.entetes)
        .send({ nom: 'Sweat édition limitée', prixExterne: 18_000 })
        .expect(200);

      expect(reponse.body).toMatchObject({
        nom: 'Sweat édition limitée',
        prixExterne: 18_000,
      });
    });

    it('refuse un rattachement à un événement inconnu', async () => {
      await creerProduit({
        evenementId: '00000000-0000-4000-8000-000000000000',
      }).expect(404);
    });

    it('répond 404 sur le stock d’un produit inconnu', async () => {
      await request(app.getHttpServer())
        .patch(`${PRODUITS}/00000000-0000-4000-8000-000000000000/stock`)
        .set(admin.entetes)
        .send({ quantite: 1 })
        .expect(404);
    });
  });

  describe('réservation de stock', () => {
    // Ces deux methodes sont le contrat que la commande consommera : leur
    // atomicite est la garantie contre la survente. Elles sont eprouvees ici
    // contre la vraie base, seul endroit ou la condition SQL a un sens.

    it('réserve ce qui est disponible, et pas au-delà', async () => {
      const id = await creerEtRecuperer({ stock: 3 });

      await expect(boutiqueService.reserverStock(id, 2)).resolves.toBe(true);
      await expect(produits.findOneByOrFail({ id })).resolves.toMatchObject({
        stock: 1,
      });

      // Deux de plus alors qu'il n'en reste qu'un : refusé, sans rien écrire.
      await expect(boutiqueService.reserverStock(id, 2)).resolves.toBe(false);
      await expect(produits.findOneByOrFail({ id })).resolves.toMatchObject({
        stock: 1,
      });
    });

    it('bascule en rupture quand la réservation vide le stock', async () => {
      const id = await creerEtRecuperer({ stock: 2 });

      await expect(boutiqueService.reserverStock(id, 2)).resolves.toBe(true);
      await expect(produits.findOneByOrFail({ id })).resolves.toMatchObject({
        stock: 0,
        statut: StatutProduit.RUPTURE,
      });
    });

    it('restitue le stock et remet en vente', async () => {
      const id = await creerEtRecuperer({ stock: 1 });
      await boutiqueService.reserverStock(id, 1);

      await boutiqueService.libererStock(id, 1);

      await expect(produits.findOneByOrFail({ id })).resolves.toMatchObject({
        stock: 1,
        statut: StatutProduit.DISPONIBLE,
      });
    });

    it('signale un produit inconnu plutôt que d’ignorer', async () => {
      await expect(
        boutiqueService.trouverOuEchouer(
          '00000000-0000-4000-8000-000000000000',
        ),
      ).rejects.toThrow();
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

  describe('stock par déclinaison', () => {
    /** Le numéro que la passerelle factice accepte. */
    const commander = (
      lignes: Record<string, unknown>[],
      compte: CompteDeTest,
    ) =>
      request(app.getHttpServer())
        .post('/api/v1/commandes')
        .set(compte.entetes)
        .send({
          lignes,
          methodePaiement: 'MTN_MOMO',
          telephone: '+237670000000',
        });

    const definir = (id: string, declinaisons: Record<string, unknown>[]) =>
      request(app.getHttpServer())
        .put(`${PRODUITS}/${id}/declinaisons`)
        .set(admin.entetes)
        .send({ declinaisons });

    it('fait du détail la somme du stock du produit', async () => {
      const id = await creerEtRecuperer({ stock: 0 });

      const reponse = await definir(id, [
        { taille: 'M', couleur: 'Noir', stock: 3 },
        { taille: 'L', couleur: 'Noir', stock: 5 },
      ]).expect(200);

      expect(reponse.body).toMatchObject({ stock: 8 });
    });

    it('refuse deux fois la même combinaison', async () => {
      // Le stock serait indéterminé, et la réservation atomique choisirait au
      // hasard laquelle décrémenter.
      const id = await creerEtRecuperer();

      await definir(id, [
        { taille: 'M', couleur: 'Noir', stock: 3 },
        { taille: 'M', couleur: 'Noir', stock: 4 },
      ]).expect(400);
    });

    it('expose ce qui reste dans chaque taille', async () => {
      const id = await creerEtRecuperer({ stock: 0 });
      await definir(id, [
        { taille: 'M', stock: 2 },
        { taille: 'L', stock: 0 },
      ]).expect(200);

      const reponse = await request(app.getHttpServer())
        .get(`${PRODUITS}/${id}/declinaisons`)
        .set(finissant.entetes)
        .expect(200);

      const grille = reponse.body as { taille: string; stock: number }[];
      expect(grille.find((d) => d.taille === 'M')?.stock).toBe(2);
      expect(grille.find((d) => d.taille === 'L')?.stock).toBe(0);
    });

    it('réserve la taille commandée, non le total', async () => {
      // Le point central : le total tient grâce aux autres tailles, mais le M
      // est épuisé. Décrémenter le compteur global le vendrait quand même.
      const id = await creerEtRecuperer({ stock: 0 });
      await definir(id, [
        { taille: 'M', stock: 1 },
        { taille: 'L', stock: 10 },
      ]).expect(200);

      await commander(
        [{ produitId: id, quantite: 1, taille: 'M' }],
        finissant,
      ).expect(201);

      // Le M est épuisé : la commande suivante doit être refusée, alors que le
      // stock global affiche encore dix.
      await commander(
        [{ produitId: id, quantite: 1, taille: 'M' }],
        externe,
      ).expect(409);

      // La taille L, elle, reste commandable.
      await commander(
        [{ produitId: id, quantite: 1, taille: 'L' }],
        externe,
      ).expect(201);
    });

    it('rend la quantité à la bonne déclinaison sur une annulation', async () => {
      const id = await creerEtRecuperer({ stock: 0 });
      await definir(id, [
        { taille: 'M', stock: 1 },
        { taille: 'L', stock: 1 },
      ]).expect(200);

      const commandeId = (
        await commander(
          [{ produitId: id, quantite: 1, taille: 'M' }],
          finissant,
        ).expect(201)
      ).body as { id: string };

      await request(app.getHttpServer())
        .delete(`/api/v1/commandes/${commandeId.id}`)
        .set(finissant.entetes)
        .expect(204);

      // Rendue au M, pas au L : gonfler l'autre laisserait une taille
      // introuvable et l'autre en surnombre.
      const grille = (
        await request(app.getHttpServer())
          .get(`${PRODUITS}/${id}/declinaisons`)
          .set(finissant.entetes)
          .expect(200)
      ).body as { taille: string; stock: number }[];

      expect(grille.find((d) => d.taille === 'M')?.stock).toBe(1);
      expect(grille.find((d) => d.taille === 'L')?.stock).toBe(1);
    });

    it('laisse intact un produit sans déclinaison', async () => {
      // Un porte-clés ne se décline pas : son stock global continue de faire
      // foi, sans quoi cette PR casserait tout le catalogue existant.
      const id = await creerEtRecuperer({ stock: 2 });

      await commander([{ produitId: id, quantite: 2 }], finissant).expect(201);
      await commander([{ produitId: id, quantite: 1 }], externe).expect(409);
    });
  });
});
