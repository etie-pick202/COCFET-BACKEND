import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { Inscription } from './../src/modules/billetterie/entities/inscription.entity';
import { Produit } from './../src/modules/boutique/entities/produit.entity';
import { MembreBureau } from './../src/modules/bureau/entities/membre-bureau.entity';
import { PosteBureau } from './../src/modules/bureau/entities/poste-bureau.entity';
import { Commande } from './../src/modules/commande/entities/commande.entity';
import { LigneCommande } from './../src/modules/commande/entities/ligne-commande.entity';
import { Document } from './../src/modules/document/entities/document.entity';
import { Evenement } from './../src/modules/evenement/entities/evenement.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { StatutPaiement } from './../src/modules/paiement/enums/paiement.enum';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

/** Ce que le contrôleur rend d'un document, relu avec son type. */
interface DocumentRendu {
  id: string;
  numero: string;
  montant: number;
}

const corps = (reponse: { body: unknown }): DocumentRendu =>
  reponse.body as DocumentRendu;

const DOCUMENTS = '/api/v1/documents';
const ANNEE_ACTIVE = 2027;

/**
 * Les pièces justificatives, de bout en bout.
 *
 * Ce qui se joue ici et qu'un dépôt simulé ne peut pas montrer : le PDF est
 * réellement composé, réellement rangé dans le stockage, et **réellement
 * régénéré** quand son fichier a disparu. C'est toute la promesse de la
 * rétention à trois mois.
 */
describe('Documents (e2e)', () => {
  let app: INestApplication<App>;

  let documents: Repository<Document>;
  let commandes: Repository<Commande>;
  let lignes: Repository<LigneCommande>;
  let produits: Repository<Produit>;
  let inscriptions: Repository<Inscription>;
  let evenements: Repository<Evenement>;
  let generations: Repository<Generation>;
  let postes: Repository<PosteBureau>;
  let membres: Repository<MembreBureau>;

  let acheteuse: CompteDeTest;
  let intruse: CompteDeTest;
  let tresoriere: CompteDeTest;
  let chargeeActivites: CompteDeTest;
  let generation: Generation;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBillet: jest.fn().mockResolvedValue(undefined),
  };

  const affecter = async (
    compte: CompteDeTest,
    nom: string,
    accedeTresorerie: boolean,
  ): Promise<void> => {
    const poste = await postes.save(
      postes.create({
        nom,
        accordeAdministration: true,
        accedeTresorerie,
        autoriseRetrait: false,
      }),
    );

    await membres.save(
      membres.create({ generation, poste, user: compte.user }),
    );
  };

  /** Commande réglée, avec sa ligne — la matière de la facture. */
  const creerCommande = async (
    statutPaiement = StatutPaiement.COMPLETE,
  ): Promise<Commande> => {
    const produit = await produits.save(
      produits.create({
        nom: 'Sweat capuche',
        description: 'Molleton gratté',
        prixCampus: 15000,
        prixExterne: 18000,
        stock: 10,
      }),
    );

    const commande = await commandes.save(
      commandes.create({
        user: acheteuse.user,
        total: 30000,
        statutPaiement,
      }),
    );

    await lignes.save(
      lignes.create({ commande, produit, quantite: 2, prix: 15000 }),
    );

    return commande;
  };

  const creerInscription = async (): Promise<Inscription> => {
    const evenement = await evenements.save(
      evenements.create({
        titre: 'Gala des finissants',
        description: 'Soirée de fin de mandat',
        dateDebut: new Date('2027-06-12T19:00:00.000Z'),
        lieu: 'Campus UCAC-ICAM',
      }),
    );

    return inscriptions.save(
      inscriptions.create({
        user: acheteuse.user,
        evenement,
        codeBillet: `BIL-${Date.now()}`,
        prix: 10000,
        statutPaiement: StatutPaiement.COMPLETE,
      }),
    );
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

    documents = app.get(getRepositoryToken(Document));
    commandes = app.get(getRepositoryToken(Commande));
    lignes = app.get(getRepositoryToken(LigneCommande));
    produits = app.get(getRepositoryToken(Produit));
    inscriptions = app.get(getRepositoryToken(Inscription));
    evenements = app.get(getRepositoryToken(Evenement));
    generations = app.get(getRepositoryToken(Generation));
    postes = app.get(getRepositoryToken(PosteBureau));
    membres = app.get(getRepositoryToken(MembreBureau));
  });

  const purger = async (): Promise<void> => {
    await documents.createQueryBuilder().delete().execute();
    await lignes.createQueryBuilder().delete().execute();
    await commandes.createQueryBuilder().delete().execute();
    await produits.createQueryBuilder().delete().execute();
    await inscriptions.createQueryBuilder().delete().execute();
    await evenements.createQueryBuilder().delete().execute();
    await membres.createQueryBuilder().delete().execute();
    await postes.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await purger();

    generation = await generations.save(
      generations.create({
        annee: ANNEE_ACTIVE,
        nom: `Promotion ${ANNEE_ACTIVE}`,
        couleurPrimaire: '#123456',
        couleurSecondaire: '#ABCDEF',
        isActive: true,
      }),
    );

    acheteuse = await creerCompteAuthentifie(app, { promotion: ANNEE_ACTIVE });
    intruse = await creerCompteAuthentifie(app, { promotion: ANNEE_ACTIVE });
    tresoriere = await creerCompteAuthentifie(app, { role: Role.ADMIN });
    chargeeActivites = await creerCompteAuthentifie(app, { role: Role.ADMIN });

    await affecter(tresoriere, 'Trésorière', true);
    await affecter(chargeeActivites, 'Chargée des activités', false);
  });

  afterAll(async () => {
    await purger();
    await app.close();
  });

  describe('facture de commande', () => {
    it('émet une facture numérotée pour une commande réglée', async () => {
      const commande = await creerCommande();

      const reponse = await request(app.getHttpServer())
        .post(`${DOCUMENTS}/facture-commande/${commande.id}`)
        .set(acheteuse.entetes)
        .expect(201);

      expect(reponse.body).toMatchObject({
        montant: 30000,
        numero: expect.stringMatching(/^FAC-\d{4}-\d{4}$/) as unknown,
      });
    });

    it('rend la même pièce quand on la redemande', async () => {
      // Sans idempotence, deux factures du même achat circuleraient sous des
      // numéros différents.
      const commande = await creerCommande();
      const url = `${DOCUMENTS}/facture-commande/${commande.id}`;

      const premiere = await request(app.getHttpServer())
        .post(url)
        .set(acheteuse.entetes)
        .expect(201);
      const seconde = await request(app.getHttpServer())
        .post(url)
        .set(acheteuse.entetes)
        .expect(201);

      expect(corps(seconde).numero).toBe(corps(premiere).numero);
      expect(await documents.count()).toBe(1);
    });

    it('refuse de facturer une commande non réglée', async () => {
      const commande = await creerCommande(StatutPaiement.EN_ATTENTE);

      await request(app.getHttpServer())
        .post(`${DOCUMENTS}/facture-commande/${commande.id}`)
        .set(acheteuse.entetes)
        .expect(409);
    });

    it('refuse la commande d’un autre compte', async () => {
      // Le contrôle est côté serveur : appeler l'API directement ne le
      // contourne pas.
      const commande = await creerCommande();

      await request(app.getHttpServer())
        .post(`${DOCUMENTS}/facture-commande/${commande.id}`)
        .set(intruse.entetes)
        .expect(403);
    });

    it('répond 404 sur une commande inconnue', async () => {
      await request(app.getHttpServer())
        .post(`${DOCUMENTS}/facture-commande/${generation.id}`)
        .set(acheteuse.entetes)
        .expect(404);
    });
  });

  describe('reçu de billetterie', () => {
    it('émet un reçu pour une inscription réglée', async () => {
      const inscription = await creerInscription();

      const reponse = await request(app.getHttpServer())
        .post(`${DOCUMENTS}/recu-billetterie/${inscription.id}`)
        .set(acheteuse.entetes)
        .expect(201);

      expect(reponse.body).toMatchObject({
        montant: 10000,
        numero: expect.stringMatching(/^REC-/) as unknown,
      });
    });

    it('répond 404 sur une inscription inconnue', async () => {
      await request(app.getHttpServer())
        .post(`${DOCUMENTS}/recu-billetterie/${generation.id}`)
        .set(acheteuse.entetes)
        .expect(404);
    });
  });

  describe('rapport de trésorerie', () => {
    it('refuse le rapport à un poste sans la trésorerie en charge', async () => {
      await request(app.getHttpServer())
        .post(`${DOCUMENTS}/rapport-tresorerie`)
        .set(chargeeActivites.entetes)
        .expect(403);
    });

    it('refuse le rapport à un compte hors du bureau', async () => {
      await request(app.getHttpServer())
        .post(`${DOCUMENTS}/rapport-tresorerie`)
        .set(acheteuse.entetes)
        .expect(403);
    });

    it('établit le rapport pour la trésorière', async () => {
      const reponse = await request(app.getHttpServer())
        .post(`${DOCUMENTS}/rapport-tresorerie`)
        .set(tresoriere.entetes)
        .expect(201);

      expect(corps(reponse).numero).toMatch(/^RAP-/);
    });

    it('laisse coexister deux rapports sur la même période', async () => {
      // Les chiffres bougent entre deux tirages : écraser le premier
      // reviendrait à réécrire un document déjà transmis.
      const premier = await request(app.getHttpServer())
        .post(`${DOCUMENTS}/rapport-tresorerie`)
        .set(tresoriere.entetes)
        .expect(201);
      const second = await request(app.getHttpServer())
        .post(`${DOCUMENTS}/rapport-tresorerie`)
        .set(tresoriere.entetes)
        .expect(201);

      expect(corps(second).numero).not.toBe(corps(premier).numero);
    });
  });

  describe('téléchargement', () => {
    /** Émet une facture et rend son identifiant. */
    const emettre = async (): Promise<string> => {
      const commande = await creerCommande();
      const reponse = await request(app.getHttpServer())
        .post(`${DOCUMENTS}/facture-commande/${commande.id}`)
        .set(acheteuse.entetes)
        .expect(201);

      return corps(reponse).id;
    };

    it('sert un PDF véritable', async () => {
      const id = await emettre();

      const reponse = await request(app.getHttpServer())
        .get(`${DOCUMENTS}/${id}/fichier`)
        .set(acheteuse.entetes)
        .buffer()
        .parse((flux, rappel) => {
          const morceaux: Buffer[] = [];
          flux.on('data', (morceau: Buffer) => morceaux.push(morceau));
          flux.on('end', () => rappel(null, Buffer.concat(morceaux)));
        })
        .expect(200)
        .expect('Content-Type', 'application/pdf');

      expect((reponse.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    });

    it('régénère la pièce dont le fichier a été purgé', async () => {
      // C'est la garantie centrale du lot : le fichier est jetable, la pièce
      // ne l'est pas.
      const id = await emettre();
      await documents.update(id, { cle: null, purgeLe: new Date() });

      await request(app.getHttpServer())
        .get(`${DOCUMENTS}/${id}/fichier`)
        .set(acheteuse.entetes)
        .expect(200);

      const document = await documents.findOneByOrFail({ id });

      // Rangée à nouveau : la deuxième ouverture ne repassera pas par le
      // dessin.
      expect(document.cle).not.toBeNull();
    });

    it('refuse le document d’un autre compte', async () => {
      const id = await emettre();

      await request(app.getHttpServer())
        .get(`${DOCUMENTS}/${id}/fichier`)
        .set(intruse.entetes)
        .expect(403);
    });

    it('laisse le bureau consulter la pièce d’un adhérent', async () => {
      const id = await emettre();

      await request(app.getHttpServer())
        .get(`${DOCUMENTS}/${id}/fichier`)
        .set(tresoriere.entetes)
        .expect(200);
    });

    it('répond 404 sur un document inconnu', async () => {
      await request(app.getHttpServer())
        .get(`${DOCUMENTS}/${generation.id}/fichier`)
        .set(acheteuse.entetes)
        .expect(404);
    });
  });
});
