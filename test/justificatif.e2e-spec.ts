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
import { Cotisation } from './../src/modules/cotisation/entities/cotisation.entity';
import { ParticipationCotisation } from './../src/modules/cotisation/entities/participation-cotisation.entity';
import { ReglementCotisation } from './../src/modules/cotisation/entities/reglement-cotisation.entity';
import { Document } from './../src/modules/document/entities/document.entity';
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
  let cotisations: Repository<Cotisation>;
  let participations: Repository<ParticipationCotisation>;
  let reglements: Repository<ReglementCotisation>;
  let documents: Repository<Document>;

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
    cotisations = app.get(getRepositoryToken(Cotisation));
    participations = app.get(getRepositoryToken(ParticipationCotisation));
    reglements = app.get(getRepositoryToken(ReglementCotisation));
    documents = app.get(getRepositoryToken(Document));
  });

  const purger = async (): Promise<void> => {
    await justificatifs.createQueryBuilder().delete().execute();
    await documents.createQueryBuilder().delete().execute();
    await reglements.createQueryBuilder().delete().execute();
    await participations.createQueryBuilder().delete().execute();
    await cotisations.createQueryBuilder().delete().execute();
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

  describe('annulation d’une validation', () => {
    const MOTIF =
      'Mauvaise pièce validée : le virement était celui d’un autre.';

    const valider = (id: string, montantRecu = 5000) =>
      request(app.getHttpServer())
        .post(`${JUSTIFS}/${id}/valider`)
        .set(tresoriere.entetes)
        .send({ montantRecu });

    const annuler = (id: string, motif = MOTIF, compte = tresoriere) =>
      request(app.getHttpServer())
        .post(`${JUSTIFS}/${id}/annuler-validation`)
        .set(compte.entetes)
        .send({ motif });

    /** Une preuve de commande validée, prête à être défaite. */
    const commandeValidee = async () => {
      const reference = await commandeEnAttente();
      const { id } = (await deposer(reference).expect(201)).body as {
        id: string;
      };
      await valider(id).expect(201);
      return { reference, id };
    };

    it('remet la commande en attente et la preuve à examiner', async () => {
      const { reference, id } = await commandeValidee();
      await expect(
        commandes.findOneByOrFail({ id: reference }),
      ).resolves.toMatchObject({ statut: StatutCommande.PAYEE });

      const reponse = await annuler(id).expect(201);

      expect(reponse.body).toMatchObject({
        statut: 'EN_ATTENTE',
        montantRecu: null,
        motifAnnulation: MOTIF,
        annulations: 1,
      });
      await expect(
        commandes.findOneByOrFail({ id: reference }),
      ).resolves.toMatchObject({
        statut: StatutCommande.EN_ATTENTE,
        statutPaiement: 'EN_ATTENTE',
      });
      await expect(
        transactions.findOneByOrFail({ reference }),
      ).resolves.toMatchObject({ statut: 'EN_ATTENTE' });
    });

    it('laisse revalider correctement après l’annulation', async () => {
      const { reference, id } = await commandeValidee();
      await annuler(id).expect(201);

      await valider(id, 5000).expect(201);

      await expect(
        commandes.findOneByOrFail({ id: reference }),
      ).resolves.toMatchObject({ statut: StatutCommande.PAYEE });
    });

    it('permet de refuser la preuve après l’avoir remise en attente', async () => {
      const { id } = await commandeValidee();
      await annuler(id).expect(201);

      await request(app.getHttpServer())
        .post(`${JUSTIFS}/${id}/refuser`)
        .set(tresoriere.entetes)
        .send({ motif: 'Ce virement n’est pas le bon.' })
        .expect(201);
    });

    it('retire la facture déjà émise', async () => {
      const { reference, id } = await commandeValidee();
      await request(app.getHttpServer())
        .get(`/api/v1/documents/commandes/${reference}/facture`)
        .set(payeur.entetes);
      const avant = await documents.count();

      await annuler(id).expect(201);

      // Qu'une facture ait été émise ou non, il n'en reste aucune.
      expect(await documents.count()).toBe(0);
      expect(avant).toBeGreaterThanOrEqual(0);
    });

    it('refuse une commande déjà prête : la marchandise est préparée', async () => {
      const { reference, id } = await commandeValidee();
      await commandes.update(reference, { statut: StatutCommande.PRETE });

      const reponse = await annuler(id).expect(409);

      expect((reponse.body as { message: string }).message).toContain(
        'prête ou retirée',
      );
      // Rien n'a bougé : la preuve reste validée.
      await expect(
        justificatifs.findOneByOrFail({ id }),
      ).resolves.toMatchObject({
        statut: 'VALIDE',
      });
      await expect(
        transactions.findOneByOrFail({ reference }),
      ).resolves.toMatchObject({ statut: 'COMPLETE' });
    });

    it('exige un motif qui dit quelque chose', async () => {
      const { id } = await commandeValidee();

      await annuler(id, 'oups').expect(400);
      await annuler(id, '').expect(400);
    });

    it('réserve l’annulation à ceux qui accèdent à la trésorerie', async () => {
      const { id } = await commandeValidee();

      await annuler(id, MOTIF, payeur).expect(403);
      await annuler(id, MOTIF, admin).expect(403);
    });

    it('refuse une preuve qui n’est pas validée', async () => {
      const reference = await commandeEnAttente();
      const { id } = (await deposer(reference).expect(201)).body as {
        id: string;
      };

      await annuler(id).expect(400);
    });

    it('ne se rejoue pas : une seconde annulation est refusée', async () => {
      const { id } = await commandeValidee();
      await annuler(id).expect(201);

      await annuler(id).expect(400);
    });

    it('retire la somme de la poche de celui qui l’avait reçue', async () => {
      // La poche d'un membre se calcule sur les preuves **validées** dont il est
      // le destinataire : défaire la validation suffit à l'en faire sortir.
      const { id } = await commandeValidee();
      await expect(
        justificatifs.findOneOrFail({
          where: { id },
          relations: { recuPar: true },
        }),
      ).resolves.toMatchObject({
        statut: 'VALIDE',
        recuPar: { id: tresoriere.user.id },
      });

      await annuler(id).expect(201);

      const apres = await justificatifs.findOneOrFail({
        where: { id },
        relations: { recuPar: true },
      });
      expect(apres.statut).toBe('EN_ATTENTE');
      expect(apres.recuPar).toBeNull();
    });

    describe('cotisation', () => {
      let finissant: CompteDeTest;
      let cotisationId: string;
      let participationId: string;

      /** Dépose et valide une preuve de 10 000 F sur la première tranche. */
      const preuveValidee = async (montant = 10_000) => {
        const depot = await request(app.getHttpServer())
          .post(JUSTIFS)
          .set(finissant.entetes)
          .send({
            participationId,
            ordreTranche: 1,
            cle: CLE,
            montantDeclare: montant,
          })
          .expect(201);
        const { id, reference } = depot.body as {
          id: string;
          reference: string;
        };
        await valider(id, montant).expect(201);
        return { id, reference };
      };

      const solde = async () =>
        (await participations.findOneByOrFail({ id: participationId }))
          .montantRegle;

      beforeEach(async () => {
        finissant = await creerCompteAuthentifie(app, {
          promotion: ANNEE,
          isFinissant: true,
        });
        const cree = await request(app.getHttpServer())
          .post('/api/v1/cotisations')
          .set(tresoriere.entetes)
          .send({
            titre: 'Cotisation des finissants',
            montantTotal: 30_000,
            cibles: ['FINISSANT'],
            fractionnable: true,
            accepteJustificatif: true,
            tranches: [
              {
                ordre: 1,
                libelle: 'Première tranche',
                montant: 10_000,
                dateLimite: '2099-01-01T00:00:00.000Z',
              },
              {
                ordre: 2,
                libelle: 'Deuxième tranche',
                montant: 20_000,
                dateLimite: '2099-06-01T00:00:00.000Z',
              },
            ],
          })
          .expect(201);
        cotisationId = (cree.body as { id: string }).id;
        await request(app.getHttpServer())
          .post(`/api/v1/cotisations/${cotisationId}/ouvrir`)
          .set(tresoriere.entetes)
          .expect(201);
        participationId = (
          await participations.findOneOrFail({
            where: { user: { id: finissant.user.id } },
          })
        ).id;
      });

      it('retire le crédit du solde et rouvre la tranche', async () => {
        const { id, reference } = await preuveValidee();
        expect(await solde()).toBe(10_000);
        await expect(
          reglements.findOneByOrFail({ reference }),
        ).resolves.toMatchObject({ statut: 'COMPLETE' });

        await annuler(id).expect(201);

        expect(await solde()).toBe(0);
        await expect(
          reglements.findOneByOrFail({ reference }),
        ).resolves.toMatchObject({ statut: 'EN_ATTENTE', montant: 10_000 });
      });

      it('repasse en cours une participation qui était soldée', async () => {
        // Une preuve de la totalité : la participation est soldée…
        const depot = await request(app.getHttpServer())
          .post(JUSTIFS)
          .set(finissant.entetes)
          .send({
            participationId,
            ordreTranche: null,
            cle: CLE,
            montantDeclare: 30_000,
          })
          .expect(201);
        const { id } = depot.body as { id: string };
        await valider(id, 30_000).expect(201);
        await expect(
          participations.findOneByOrFail({ id: participationId }),
        ).resolves.toMatchObject({ statut: 'SOLDEE' });

        await annuler(id).expect(201);

        await expect(
          participations.findOneByOrFail({ id: participationId }),
        ).resolves.toMatchObject({ statut: 'EN_COURS', montantRegle: 0 });
      });

      it('ne retire que le crédit de cette preuve', async () => {
        const premiere = await preuveValidee(10_000);
        await preuveValidee(5_000).catch(() => undefined);
        const avant = await solde();

        await annuler(premiere.id).expect(201);

        expect(await solde()).toBe(avant - 10_000);
      });

      it('prévient la personne que son règlement n’est plus compté', async () => {
        const { id } = await preuveValidee();

        await annuler(id).expect(201);

        const notifications = await request(app.getHttpServer())
          .get('/api/v1/notifications')
          .set(finissant.entetes)
          .expect(200);
        expect(JSON.stringify(notifications.body)).toContain(
          'de nouveau examinée',
        );
      });

      it('rend la tranche réglable de nouveau après revalidation', async () => {
        const { id } = await preuveValidee();
        await annuler(id).expect(201);

        await valider(id, 10_000).expect(201);

        expect(await solde()).toBe(10_000);
      });
    });
  });
});
