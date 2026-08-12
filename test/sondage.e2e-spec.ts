import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { OptionSondage } from './../src/modules/sondage/entities/option-sondage.entity';
import { ParticipationSondage } from './../src/modules/sondage/entities/participation-sondage.entity';
import { Sondage } from './../src/modules/sondage/entities/sondage.entity';
import { Vote } from './../src/modules/sondage/entities/vote.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const SONDAGES = '/api/v1/sondages';
const ANNEE_ACTIVE = 2027;

/** Loin devant : un sondage dont la date limite est passée refuse les votes. */
const DEADLINE = '2099-07-01T23:59:00.000Z';

/**
 * Ce que seul un banc de bout en bout peut établir.
 *
 * Le vote unique ne repose pas sur une vérification préalable — deux requêtes
 * simultanées la passeraient toutes les deux — mais sur une **contrainte
 * d'unicité en base**, dont la violation est traduite en 409. Un dépôt simulé
 * ne lève pas cette erreur : la garantie ne se vérifie que contre un vrai
 * Postgres.
 *
 * Même chose pour l'anonymat : que le bulletin ne porte pas son auteur se
 * constate en relisant la table, pas en interrogeant l'API.
 */
describe('Sondages (e2e)', () => {
  let app: INestApplication<App>;
  let sondages: Repository<Sondage>;
  let options: Repository<OptionSondage>;
  let votes: Repository<Vote>;
  let participations: Repository<ParticipationSondage>;
  let generations: Repository<Generation>;

  let admin: CompteDeTest;
  let etudiant: CompteDeTest;
  let externe: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
  };

  const creer = (surcharge: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(SONDAGES)
      .set(admin.entetes)
      .send({
        titre: 'Quel thème pour le gala des finissants ?',
        options: ['Années folles', 'Afrofuturisme', 'Black tie'],
        deadline: DEADLINE,
        ...surcharge,
      });

  const activer = (id: string) =>
    request(app.getHttpServer())
      .post(`${SONDAGES}/${id}/activer`)
      .set(admin.entetes);

  const voter = (id: string, compte: CompteDeTest, optionIds: string[]) =>
    request(app.getHttpServer())
      .post(`${SONDAGES}/${id}/voter`)
      .set(compte.entetes)
      .send({ optionIds });

  const consulter = (id: string, compte: CompteDeTest) =>
    request(app.getHttpServer()).get(`${SONDAGES}/${id}`).set(compte.entetes);

  const depouiller = (id: string, compte: CompteDeTest) =>
    request(app.getHttpServer())
      .get(`${SONDAGES}/${id}/resultats`)
      .set(compte.entetes);

  /** Crée, active, et rend l'identifiant du sondage avec ceux de ses options. */
  const ouvrir = async (
    surcharge: Record<string, unknown> = {},
  ): Promise<{ id: string; optionIds: string[] }> => {
    const cree = await creer(surcharge).expect(201);
    const { id } = cree.body as { id: string };
    await activer(id).expect(201);

    const corps = (await consulter(id, admin).expect(200)).body as {
      options: { id: string }[];
    };

    return { id, optionIds: corps.options.map((option) => option.id) };
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

    sondages = app.get(getRepositoryToken(Sondage));
    options = app.get(getRepositoryToken(OptionSondage));
    votes = app.get(getRepositoryToken(Vote));
    participations = app.get(getRepositoryToken(ParticipationSondage));
    generations = app.get(getRepositoryToken(Generation));
  });

  const purger = async (): Promise<void> => {
    await votes.createQueryBuilder().delete().execute();
    await participations.createQueryBuilder().delete().execute();
    await options.createQueryBuilder().delete().execute();
    await sondages.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    await purger();

    await generations.save(
      generations.create({
        annee: ANNEE_ACTIVE,
        nom: 'ATLAS',
        isActive: true,
      }),
    );

    admin = await creerCompteAuthentifie(app, {
      role: Role.ADMIN,
      promotion: ANNEE_ACTIVE,
    });
    etudiant = await creerCompteAuthentifie(app, { promotion: ANNEE_ACTIVE });
    externe = await creerCompteAuthentifie(app, { role: Role.VISITOR });
  });

  afterAll(async () => {
    await purger();
    await app.close();
  });

  describe('cycle de vie', () => {
    it('crée un sondage en brouillon, invisible au public', async () => {
      const { id } = (await creer().expect(201)).body as { id: string };

      // Un brouillon se relit par son auteur, jamais par les votants : la
      // question n'est pas arrêtée tant qu'elle n'est pas ouverte.
      await consulter(id, admin).expect(200);
      await consulter(id, etudiant).expect(404);
    });

    it('refuse la création à qui n’administre pas', async () => {
      await request(app.getHttpServer())
        .post(SONDAGES)
        .set(etudiant.entetes)
        .send({
          titre: 'Sondage pirate',
          options: ['A', 'B'],
          deadline: DEADLINE,
        })
        .expect(403);
    });

    it('refuse deux options identiques', async () => {
      // Elles répartiraient les voix d'un même choix sur deux lignes, et le
      // dépouillement conclurait à l'inverse de l'intention.
      await creer({ options: ['Black tie', 'Black tie'] }).expect(400);
    });

    it('refuse un sondage à option unique', async () => {
      await creer({ options: ['Une seule'] }).expect(400);
    });

    it('n’accepte le vote qu’une fois le sondage ouvert', async () => {
      const { id } = (await creer().expect(201)).body as { id: string };
      const brouillon = (await consulter(id, admin).expect(200)).body as {
        options: { id: string }[];
      };

      await voter(id, etudiant, [brouillon.options[0].id]).expect(409);
    });

    it('clôt un sondage et refuse les votes suivants', async () => {
      const { id, optionIds } = await ouvrir();
      await voter(id, etudiant, [optionIds[0]]).expect(201);

      await request(app.getHttpServer())
        .post(`${SONDAGES}/${id}/clore`)
        .set(admin.entetes)
        .expect(201);

      await voter(id, admin, [optionIds[0]]).expect(409);
    });

    it('refuse de supprimer un sondage ayant reçu des bulletins', async () => {
      // Effacer le sondage effacerait le résultat d'une consultation qui a eu
      // lieu.
      const { id, optionIds } = await ouvrir();
      await voter(id, etudiant, [optionIds[0]]).expect(201);

      await request(app.getHttpServer())
        .delete(`${SONDAGES}/${id}`)
        .set(admin.entetes)
        .expect(403);
    });
  });

  describe('vote', () => {
    it('enregistre un bulletin et incrémente le décompte', async () => {
      const { id, optionIds } = await ouvrir({
        visibiliteResultats: 'TOUJOURS',
      });

      const reponse = await voter(id, etudiant, [optionIds[0]]).expect(201);
      const resultats = reponse.body as {
        totalVotes: number;
        aVote: boolean;
        options: { id: string; votes: number | null }[];
      };

      expect(resultats.totalVotes).toBe(1);
      expect(resultats.aVote).toBe(true);
      expect(
        resultats.options.find((option) => option.id === optionIds[0])?.votes,
      ).toBe(1);
    });

    it('refuse le second bulletin de la même personne', async () => {
      // La garantie tient à une contrainte d'unicité en base, pas à une
      // vérification préalable : c'est ici, contre un vrai Postgres, qu'elle
      // se constate.
      const { id, optionIds } = await ouvrir();

      await voter(id, etudiant, [optionIds[0]]).expect(201);
      await voter(id, etudiant, [optionIds[1]]).expect(409);

      await expect(votes.count()).resolves.toBe(1);
    });

    it('refuse deux réponses à un sondage à choix unique', async () => {
      const { id, optionIds } = await ouvrir();

      await voter(id, etudiant, [optionIds[0], optionIds[1]]).expect(400);
    });

    it('accepte plusieurs réponses à un sondage à choix multiple', async () => {
      const { id, optionIds } = await ouvrir({
        type: 'CHOIX_MULTIPLE',
        visibiliteResultats: 'TOUJOURS',
      });

      const reponse = await voter(id, etudiant, [
        optionIds[0],
        optionIds[1],
      ]).expect(201);

      // Compte des votants, pas des choix exprimés : additionner les choix
      // rendrait les pourcentages incomparables d'une option à l'autre.
      expect((reponse.body as { totalVotes: number }).totalVotes).toBe(1);
    });

    it('refuse une option appartenant à un autre sondage', async () => {
      // Elle incrémenterait un compteur étranger.
      const premier = await ouvrir();
      const second = await ouvrir({ titre: 'Quel menu pour le gala ?' });

      await voter(premier.id, etudiant, [second.optionIds[0]]).expect(400);
    });

    it('écarte le visiteur extérieur d’un sondage réservé au campus', async () => {
      const { id, optionIds } = await ouvrir();

      await voter(id, externe, [optionIds[0]]).expect(403);
    });

    it('laisse voter l’administration, qui est du campus', async () => {
      // Le critère est la promotion, non le rôle : un membre du bureau est
      // étudiant du campus et doit pouvoir répondre.
      const { id, optionIds } = await ouvrir();

      await voter(id, admin, [optionIds[0]]).expect(201);
    });

    it('ouvre au visiteur un sondage qui ne réserve pas', async () => {
      const { id, optionIds } = await ouvrir({ campusUniquement: false });

      await voter(id, externe, [optionIds[0]]).expect(201);
    });
  });

  describe('anonymat', () => {
    it('n’attache pas le bulletin à son auteur, tout en interdisant le doublon', async () => {
      const { id, optionIds } = await ouvrir({ isAnonyme: true });

      await voter(id, etudiant, [optionIds[0]]).expect(201);

      const bulletins = await votes.find({ relations: { user: true } });
      expect(bulletins).toHaveLength(1);
      expect(bulletins[0].user).toBeNull();

      // La participation, elle, est bien enregistrée : c'est ce qui interdit
      // le double vote sans révéler le choix.
      await expect(participations.count()).resolves.toBe(1);
      await voter(id, etudiant, [optionIds[1]]).expect(409);
    });
  });

  describe('visibilité du dépouillement', () => {
    it('masque les décomptes avant d’avoir voté', async () => {
      const { id } = await ouvrir({ visibiliteResultats: 'APRES_VOTE' });

      const corps = (await depouiller(id, etudiant).expect(200)).body as {
        resultatsVisibles: boolean;
        options: { votes: number | null; pourcentage: number | null }[];
      };

      expect(corps.resultatsVisibles).toBe(false);
      // Nuls et non omis : un champ absent se confondrait avec un score de
      // zéro.
      expect(corps.options[0].votes).toBeNull();
      expect(corps.options[0].pourcentage).toBeNull();
    });

    it('les révèle une fois le bulletin déposé', async () => {
      const { id, optionIds } = await ouvrir({
        visibiliteResultats: 'APRES_VOTE',
      });
      await voter(id, etudiant, [optionIds[0]]).expect(201);

      const corps = (await depouiller(id, etudiant).expect(200)).body as {
        resultatsVisibles: boolean;
        options: { votes: number | null }[];
      };

      expect(corps.resultatsVisibles).toBe(true);
      expect(corps.options.some((option) => option.votes === 1)).toBe(true);
    });

    it('les tient cachés jusqu’à la date limite quand c’est le réglage', async () => {
      const { id, optionIds } = await ouvrir({
        visibiliteResultats: 'APRES_DEADLINE',
      });
      await voter(id, etudiant, [optionIds[0]]).expect(201);

      const corps = (await depouiller(id, etudiant).expect(200)).body as {
        resultatsVisibles: boolean;
      };

      // Voter ne suffit pas : la date limite n'est pas passée.
      expect(corps.resultatsVisibles).toBe(false);
    });
  });

  describe('liste', () => {
    it('ne montre aux votants que les sondages ouverts', async () => {
      await creer({ titre: 'Brouillon jamais ouvert' }).expect(201);
      const ouvert = await ouvrir({ titre: 'Sondage ouvert au vote' });

      const corps = (
        await request(app.getHttpServer())
          .get(SONDAGES)
          .set(etudiant.entetes)
          .expect(200)
      ).body as { donnees: { id: string }[] };

      expect(corps.donnees).toHaveLength(1);
      expect(corps.donnees[0].id).toBe(ouvert.id);
    });

    it('accepte le filtre par événement', async () => {
      // Chaque branche du constructeur de requêtes doit être empruntée au
      // moins une fois : un chemin jamais exécuté est un 500 en attente.
      await ouvrir();

      const corps = (
        await request(app.getHttpServer())
          .get(SONDAGES)
          .query({ evenementId: '00000000-0000-4000-8000-000000000000' })
          .set(etudiant.entetes)
          .expect(200)
      ).body as { donnees: unknown[] };

      expect(corps.donnees).toHaveLength(0);
    });

    it('accepte le filtre des sondages ouverts', async () => {
      const ouvert = await ouvrir();

      const corps = (
        await request(app.getHttpServer())
          .get(SONDAGES)
          .query({ ouverts: true })
          .set(etudiant.entetes)
          .expect(200)
      ).body as { donnees: { id: string }[] };

      expect(corps.donnees.map((s) => s.id)).toContain(ouvert.id);
    });
  });
});
