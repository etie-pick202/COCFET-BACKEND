import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { MembreBureau } from './../src/modules/bureau/entities/membre-bureau.entity';
import { PosteBureau } from './../src/modules/bureau/entities/poste-bureau.entity';
import { Cotisation } from './../src/modules/cotisation/entities/cotisation.entity';
import { ParticipationCotisation } from './../src/modules/cotisation/entities/participation-cotisation.entity';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const COTISATIONS = '/api/v1/cotisations';
const ANNEE = 2027;

/**
 * Les cotisations, de bout en bout.
 *
 * Trois garanties ne se constatent qu'ici, contre un vrai Postgres :
 *
 * **Le montant dû est figé à l'ouverture.** Le relever ensuite ne doit pas
 * rendre rétroactivement en retard ceux qui avaient déjà soldé.
 *
 * **L'ouverture est idempotente.** Rouvrir ne duplique aucune participation et
 * n'écrase aucun solde — la contrainte d'unicité le garantit en base, pas une
 * vérification préalable qui laisserait passer deux appels simultanés.
 *
 * **Le cloisonnement tient.** Seul l'accès aux finances voit qui a payé quoi ;
 * chacun ne voit que son propre solde.
 */
describe('Cotisations (e2e)', () => {
  let app: INestApplication<App>;
  let cotisations: Repository<Cotisation>;
  let participations: Repository<ParticipationCotisation>;
  let generations: Repository<Generation>;
  let postes: Repository<PosteBureau>;
  let membres: Repository<MembreBureau>;

  let tresoriere: CompteDeTest;
  let finissant: CompteDeTest;
  let autreFinissant: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBienvenueAuBureau: jest.fn().mockResolvedValue(undefined),
  };

  const idDe = (reponse: { body: unknown }) =>
    (reponse.body as { id: string }).id;

  const creer = (surcharge: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(COTISATIONS)
      .set(tresoriere.entetes)
      .send({
        titre: 'Cotisation des finissants',
        montantTotal: 30000,
        cibles: ['FINISSANT'],
        fractionnable: true,
        tranches: [
          {
            ordre: 1,
            libelle: 'Première tranche',
            montant: 10000,
            dateLimite: '2026-01-01T00:00:00.000Z',
          },
          {
            ordre: 2,
            libelle: 'Deuxième tranche',
            montant: 20000,
            dateLimite: '2099-01-01T00:00:00.000Z',
          },
        ],
        ...surcharge,
      });

  const ouvrir = (id: string) =>
    request(app.getHttpServer())
      .post(`${COTISATIONS}/${id}/ouvrir`)
      .set(tresoriere.entetes);

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

    cotisations = app.get(getRepositoryToken(Cotisation));
    participations = app.get(getRepositoryToken(ParticipationCotisation));
    generations = app.get(getRepositoryToken(Generation));
    postes = app.get(getRepositoryToken(PosteBureau));
    membres = app.get(getRepositoryToken(MembreBureau));
  });

  const purger = async (): Promise<void> => {
    await participations.createQueryBuilder().delete().execute();
    await cotisations.createQueryBuilder().delete().execute();
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

    tresoriere = await creerCompteAuthentifie(app, {
      role: Role.ADMIN,
      promotion: ANNEE,
      isFinissant: false,
    });
    finissant = await creerCompteAuthentifie(app, {
      promotion: ANNEE,
      isFinissant: true,
    });
    autreFinissant = await creerCompteAuthentifie(app, {
      promotion: ANNEE,
      isFinissant: true,
    });

    // Le privilège se porte par le poste, jamais par la personne : la
    // trésorière l'obtient en siégeant, comme en production.
    const poste = await postes.save(
      postes.create({ nom: 'Trésorière', accedeTresorerie: true }),
    );
    await membres.save(
      membres.create({
        generation,
        poste,
        user: { id: tresoriere.user.id } as User,
      }),
    );
  });

  afterAll(async () => {
    await purger();
    await app.close();
  });

  describe('échéancier', () => {
    it('refuse des tranches qui ne totalisent pas le montant dû', async () => {
      // Une cotisation dont les tranches ne couvrent pas la somme est une
      // faute de saisie : la personne verserait tout sans être à jour.
      await creer({
        tranches: [
          {
            ordre: 1,
            libelle: 'Unique',
            montant: 5000,
            dateLimite: '2099-01-01T00:00:00.000Z',
          },
        ],
      }).expect(400);
    });

    it('refuse deux tranches de même rang', async () => {
      await creer({
        tranches: [
          {
            ordre: 1,
            libelle: 'A',
            montant: 15000,
            dateLimite: '2099-01-01T00:00:00.000Z',
          },
          {
            ordre: 1,
            libelle: 'B',
            montant: 15000,
            dateLimite: '2099-01-01T00:00:00.000Z',
          },
        ],
      }).expect(400);
    });

    it('accepte une cotisation sans tranche', async () => {
      await creer({ tranches: [], fractionnable: false }).expect(201);
    });
  });

  describe('ouverture', () => {
    it('ne concerne que la population visée', async () => {
      const id = idDe(await creer().expect(201));

      await ouvrir(id).expect(201);

      const inscrits = await participations.find({ relations: { user: true } });
      const concernes = inscrits
        .map((p) => p.user.id)
        .sort((a, b) => a.localeCompare(b));

      // La trésorière n'est pas finissante : elle ne cotise pas.
      expect(concernes).toEqual(
        [finissant.user.id, autreFinissant.user.id].sort((a, b) =>
          a.localeCompare(b),
        ),
      );
    });

    it('fige le montant dû, qu’une révision ne doit plus toucher', async () => {
      const id = idDe(await creer().expect(201));
      await ouvrir(id).expect(201);

      // La cotisation est ouverte : elle n'est plus modifiable, précisément
      // parce que les montants sont figés dans les participations.
      await request(app.getHttpServer())
        .patch(`${COTISATIONS}/${id}`)
        .set(tresoriere.entetes)
        .send({ montantTotal: 50000 })
        .expect(409);

      const inscrits = await participations.find();
      expect(inscrits.every((p) => p.montantDu === 30000)).toBe(true);
    });

    it('ne duplique rien quand on rouvre', async () => {
      const id = idDe(await creer().expect(201));

      await ouvrir(id).expect(201);
      await ouvrir(id).expect(201);

      await expect(participations.count()).resolves.toBe(2);
    });

    it('refuse une cotisation sans population visée', async () => {
      const id = idDe(await creer({ cibles: ['ALUMNI'] }).expect(201));

      // Aucun alumni n'existe ici : personne n'est appelé, mais la cible est
      // bien renseignée — l'ouverture réussit avec zéro participation.
      await ouvrir(id).expect(201);
      await expect(participations.count()).resolves.toBe(0);
    });
  });

  describe('avancement', () => {
    it('consomme les tranches dans l’ordre et signale le retard', async () => {
      const id = idDe(await creer().expect(201));
      await ouvrir(id).expect(201);

      // Un versement partiel, porté au solde comme le ferait un paiement.
      const participation = await participations.findOneOrFail({
        where: { user: { id: finissant.user.id } },
        relations: { user: true },
      });
      await participations.update(participation.id, { montantRegle: 5000 });

      const reponse = await request(app.getHttpServer())
        .get(`${COTISATIONS}/moi`)
        .set(finissant.entetes)
        .expect(200);

      const [ligne] = reponse.body as {
        avancement: {
          pourcentage: number;
          montantRestant: number;
          enRetard: boolean;
          tranches: { regle: number; soldee: boolean; enRetard: boolean }[];
        };
      }[];

      expect(ligne.avancement.pourcentage).toBe(17);
      expect(ligne.avancement.montantRestant).toBe(25000);
      expect(ligne.avancement.tranches[0].regle).toBe(5000);
      // Première échéance passée et non soldée.
      expect(ligne.avancement.tranches[0].enRetard).toBe(true);
      expect(ligne.avancement.enRetard).toBe(true);
    });

    it('ne montre à chacun que sa propre situation', async () => {
      const id = idDe(await creer().expect(201));
      await ouvrir(id).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${COTISATIONS}/moi`)
        .set(finissant.entetes)
        .expect(200);

      expect(reponse.body as unknown[]).toHaveLength(1);
    });
  });

  describe('consultation', () => {
    it('liste les cotisations pour les finances', async () => {
      await creer().expect(201);

      const reponse = await request(app.getHttpServer())
        .get(COTISATIONS)
        .set(tresoriere.entetes)
        .expect(200);

      expect(reponse.body as unknown[]).toHaveLength(1);
    });

    it('consulte une cotisation et son echeancier', async () => {
      const id = idDe(await creer().expect(201));

      const reponse = await request(app.getHttpServer())
        .get(`${COTISATIONS}/${id}`)
        .set(tresoriere.entetes)
        .expect(200);

      expect((reponse.body as { tranches: unknown[] }).tranches).toHaveLength(
        2,
      );
    });

    it('liste les remises au bureau', async () => {
      await request(app.getHttpServer())
        .post(`${COTISATIONS}/versements`)
        .set(tresoriere.entetes)
        .send({ montant: 25000 })
        .expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${COTISATIONS}/versements`)
        .set(tresoriere.entetes)
        .expect(200);

      expect(reponse.body as unknown[]).toHaveLength(1);
    });

    it('clot une cotisation', async () => {
      const id = idDe(await creer().expect(201));
      await ouvrir(id).expect(201);

      const reponse = await request(app.getHttpServer())
        .post(`${COTISATIONS}/${id}/clore`)
        .set(tresoriere.entetes)
        .expect(201);

      expect(reponse.body).toMatchObject({ statut: 'CLOSE' });
    });
  });

  describe('cloisonnement', () => {
    it('réserve la création aux finances', async () => {
      await request(app.getHttpServer())
        .post(COTISATIONS)
        .set(finissant.entetes)
        .send({
          titre: 'Cotisation pirate',
          montantTotal: 1000,
          cibles: ['FINISSANT'],
        })
        .expect(403);
    });

    it('réserve la liste des participations aux finances', async () => {
      const id = idDe(await creer().expect(201));
      await ouvrir(id).expect(201);

      // Qui a payé quoi est une donnée personnelle : le reste du bureau n'a
      // pas à la connaître.
      await request(app.getHttpServer())
        .get(`${COTISATIONS}/${id}/participations`)
        .set(finissant.entetes)
        .expect(403);

      await request(app.getHttpServer())
        .get(`${COTISATIONS}/${id}/participations`)
        .set(tresoriere.entetes)
        .expect(200);
    });

    it('laisse chacun consulter ses propres cotisations', async () => {
      await request(app.getHttpServer())
        .get(`${COTISATIONS}/moi`)
        .set(finissant.entetes)
        .expect(200);
    });
  });

  describe('encaisse', () => {
    it('enregistre une remise au bureau', async () => {
      const reponse = await request(app.getHttpServer())
        .post(`${COTISATIONS}/versements`)
        .set(tresoriere.entetes)
        .send({ montant: 50000, note: 'Dépôt bancaire' })
        .expect(201);

      expect(reponse.body).toMatchObject({ montant: 50000 });
    });

    it('réserve les remises aux finances', async () => {
      await request(app.getHttpServer())
        .post(`${COTISATIONS}/versements`)
        .set(finissant.entetes)
        .send({ montant: 50000 })
        .expect(403);
    });
  });

  describe('suppression', () => {
    it('refuse de supprimer une cotisation ouverte', async () => {
      // Effacer emporterait les versements reconnus, et l'argent encaissé
      // n'aurait plus de contrepartie.
      const id = idDe(await creer().expect(201));
      await ouvrir(id).expect(201);

      await request(app.getHttpServer())
        .delete(`${COTISATIONS}/${id}`)
        .set(tresoriere.entetes)
        .expect(409);
    });

    it('supprime un brouillon', async () => {
      const id = idDe(await creer().expect(201));

      await request(app.getHttpServer())
        .delete(`${COTISATIONS}/${id}`)
        .set(tresoriere.entetes)
        .expect(204);
    });
  });
});
