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
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const BUREAU = '/api/v1/bureau';
const GENERATIONS = '/api/v1/generations';

/**
 * Le COCFET — comité d'organisation de la cérémonie de fin d'étude — est un
 * bureau de finissants. Deux règles structurent ce module et se vérifient ici :
 * on n'y siège que si l'on est finissant du mandat concerné, et **un alumni
 * n'administre pas** — la passation se fait en désignant ses successeurs.
 */
describe('Bureau COCFET (e2e)', () => {
  let app: INestApplication<App>;
  let postes: Repository<PosteBureau>;
  let membres: Repository<MembreBureau>;
  let generations: Repository<Generation>;
  let users: Repository<User>;

  let admin: CompteDeTest;
  let sortant: CompteDeTest;
  let entrant: CompteDeTest;

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

  const creerPoste = (nom: string, surcharge: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`${BUREAU}/postes`)
      .set(admin.entetes)
      .send({ nom, ...surcharge });

  const creerGeneration = (annee: number, nom: string) =>
    request(app.getHttpServer())
      .post(GENERATIONS)
      .set(admin.entetes)
      .send({ annee, nom });

  const affecter = (generationId: string, posteId: string, userId: string) =>
    request(app.getHttpServer())
      .post(`${BUREAU}/${generationId}/membres`)
      .set(admin.entetes)
      .send({ posteId, userId });

  const activer = (id: string) =>
    request(app.getHttpServer())
      .post(`${GENERATIONS}/${id}/activer`)
      .set(admin.entetes);

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

    postes = app.get(getRepositoryToken(PosteBureau));
    membres = app.get(getRepositoryToken(MembreBureau));
    generations = app.get(getRepositoryToken(Generation));
    users = app.get(getRepositoryToken(User));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await membres.createQueryBuilder().delete().execute();
    await postes.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);

    // Administration technique : aucune promotion, donc jamais alumni.
    admin = await creerCompteAuthentifie(app, {
      role: Role.ADMIN,
      promotion: null,
    });
    sortant = await creerCompteAuthentifie(app, { promotion: 2026 });
    entrant = await creerCompteAuthentifie(app, { promotion: 2027 });
  });

  afterAll(async () => {
    await membres.createQueryBuilder().delete().execute();
    await postes.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('catalogue des postes', () => {
    it('crée un poste et le retrouve', async () => {
      await creerPoste('Président', { ordre: 1, estCle: true }).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${BUREAU}/postes`)
        .set(admin.entetes)
        .expect(200);

      expect(reponse.body as unknown[]).toHaveLength(1);
    });

    it('refuse un nom déjà pris', async () => {
      await creerPoste('Trésorier').expect(201);
      await creerPoste('Trésorier').expect(409);
    });

    it('refuse de supprimer un poste déjà occupé', async () => {
      // Effacer le poste effacerait la trace de qui l'a occupé.
      const poste = idDe(await creerPoste('Président').expect(201));
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));
      await affecter(generation, poste, entrant.user.id).expect(201);

      await request(app.getHttpServer())
        .delete(`${BUREAU}/postes/${poste}`)
        .set(admin.entetes)
        .expect(409);
    });

    it('supprime un poste jamais attribué', async () => {
      const poste = idDe(await creerPoste('Poste créé par erreur').expect(201));

      await request(app.getHttpServer())
        .delete(`${BUREAU}/postes/${poste}`)
        .set(admin.entetes)
        .expect(204);
    });

    it('est réservé au bureau', async () => {
      await request(app.getHttpServer())
        .get(`${BUREAU}/postes`)
        .set(entrant.entetes)
        .expect(403);
    });
  });

  describe('composition du bureau', () => {
    it('n’accepte qu’un finissant de la génération concernée', async () => {
      // Le COCFET organise la cérémonie de fin d'étude : il est composé de
      // ceux qui la vivent.
      const poste = idDe(await creerPoste('Président').expect(201));
      const g2027 = idDe(await creerGeneration(2027, 'ATLAS').expect(201));

      await affecter(g2027, poste, entrant.user.id).expect(201);
      await expect(membres.count()).resolves.toBe(1);

      const g2026 = idDe(await creerGeneration(2026, 'ORION').expect(201));
      await affecter(g2026, poste, entrant.user.id).expect(400);
    });

    it('refuse un compte dont l’adresse n’est pas confirmée', async () => {
      const poste = idDe(await creerPoste('Président').expect(201));
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));
      const nonVerifie = await creerCompteAuthentifie(app, {
        promotion: 2027,
        emailVerifie: false,
      });

      await affecter(generation, poste, nonVerifie.user.id).expect(400);
    });

    it('refuse deux titulaires pour un même poste', async () => {
      const poste = idDe(await creerPoste('Président').expect(201));
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));
      const autre = await creerCompteAuthentifie(app, { promotion: 2027 });

      await affecter(generation, poste, entrant.user.id).expect(201);
      await affecter(generation, poste, autre.user.id).expect(409);
    });

    it('laisse une personne cumuler deux postes', async () => {
      const president = idDe(await creerPoste('Président').expect(201));
      const tresorier = idDe(await creerPoste('Trésorier').expect(201));
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));

      await affecter(generation, president, entrant.user.id).expect(201);
      await affecter(generation, tresorier, entrant.user.id).expect(201);
    });

    it('accueille le membre désigné, poste et mandat nommés', async () => {
      faussaireMail.envoyerBienvenueAuBureau.mockClear();

      const poste = idDe(await creerPoste('Trésorier').expect(201));
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));

      await affecter(generation, poste, entrant.user.id).expect(201);

      expect(faussaireMail.envoyerBienvenueAuBureau).toHaveBeenCalledWith(
        entrant.user.email,
        expect.any(String),
        expect.objectContaining({ poste: 'Trésorier', mandat: 'ATLAS' }),
      );
    });

    it('retire un membre', async () => {
      const poste = idDe(await creerPoste('Président').expect(201));
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));
      const membre = idDe(
        await affecter(generation, poste, entrant.user.id).expect(201),
      );

      await request(app.getHttpServer())
        .delete(`${BUREAU}/membres/${membre}`)
        .set(admin.entetes)
        .expect(204);

      await expect(membres.count()).resolves.toBe(0);
    });

    /**
     * Cette route charge la relation `user` et renvoyait l'entité de compte
     * entière : les empreintes du mot de passe et du refresh token partaient
     * dans le JSON, pour chaque membre du bureau. Le corps est inspecté
     * entièrement, et pas seulement le premier niveau — les empreintes
     * arrivaient imbriquées sous `user`, là où un `not.toHaveProperty` posé à
     * la racine ne les aurait pas vues.
     */
    it('ne laisse aucune empreinte dans la composition d’un mandat', async () => {
      const poste = idDe(await creerPoste('Président').expect(201));
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));
      await affecter(generation, poste, entrant.user.id).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${BUREAU}/${generation}/membres`)
        .set(admin.entetes)
        .expect(200);

      const corps = reponse.body as Record<string, unknown>[];
      expect(corps).toHaveLength(1);
      expect(corps[0]).toMatchObject({
        poste: { nom: 'Président' },
        membre: { id: entrant.user.id },
      });

      const brut = JSON.stringify(corps);
      expect(brut).not.toContain('passwordHash');
      expect(brut).not.toContain('refreshTokenHash');
      // L'empreinte bcrypt elle-même, au cas où un futur renommage de champ
      // ferait passer les deux assertions précédentes.
      expect(brut).not.toContain('$2b$');
    });

    it('ne laisse aucune empreinte en désignant ou modifiant un membre', async () => {
      const poste = idDe(await creerPoste('Président').expect(201));
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));

      const creation = await affecter(
        generation,
        poste,
        entrant.user.id,
      ).expect(201);

      const modification = await request(app.getHttpServer())
        .patch(`${BUREAU}/membres/${idDe(creation)}`)
        .set(admin.entetes)
        .send({ presentation: 'Chargé de la cérémonie.' })
        .expect(200);

      for (const corps of [creation.body, modification.body]) {
        const brut = JSON.stringify(corps);
        expect(brut).not.toContain('passwordHash');
        expect(brut).not.toContain('refreshTokenHash');
        expect(brut).not.toContain('$2b$');
      }
    });
  });

  describe('activation d’un mandat', () => {
    it('refuse un bureau dont les postes clés ne sont pas pourvus', async () => {
      // Sans ce contrôle, la plateforme basculerait sur un bureau inexistant.
      await creerPoste('Président', {
        estCle: true,
        accordeAdministration: true,
      }).expect(201);
      await creerPoste('Secrétaire', { estCle: true }).expect(201);
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));

      await activer(generation).expect(400);
    });

    it('refuse un bureau sans aucun poste administrateur pourvu', async () => {
      const secretaire = idDe(
        await creerPoste('Secrétaire', { estCle: true }).expect(201),
      );
      await creerPoste('Président', { accordeAdministration: true }).expect(
        201,
      );
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));

      await affecter(generation, secretaire, entrant.user.id).expect(201);

      // Les postes clés sont pourvus, mais personne ne pourrait piloter la
      // plateforme après la bascule.
      await activer(generation).expect(400);
    });

    it('accepte un bureau complet', async () => {
      const president = idDe(
        await creerPoste('Président', {
          estCle: true,
          accordeAdministration: true,
        }).expect(201),
      );
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));
      await affecter(generation, president, entrant.user.id).expect(201);

      await activer(generation).expect(201);
    });
  });

  describe('passation d’administration', () => {
    /** Met en place deux mandats : 2026 sortant, 2027 entrant. */
    const preparerPassation = async () => {
      const president = idDe(
        await creerPoste('Président', {
          estCle: true,
          accordeAdministration: true,
        }).expect(201),
      );

      const g2026 = idDe(await creerGeneration(2026, 'ORION').expect(201));
      await affecter(g2026, president, sortant.user.id).expect(201);
      await activer(g2026).expect(201);

      const g2027 = idDe(await creerGeneration(2027, 'ATLAS').expect(201));
      await affecter(g2027, president, entrant.user.id).expect(201);

      return { g2027 };
    };

    it('promeut les entrants et rétrograde les sortants', async () => {
      const { g2027 } = await preparerPassation();

      await expect(
        users.findOne({ where: { id: sortant.user.id } }),
      ).resolves.toMatchObject({ role: Role.ADMIN });

      await activer(g2027).expect(201);

      // Le COCFET est un bureau de finissants : une fois la promotion sortie,
      // ses membres deviennent alumni et n'administrent plus.
      await expect(
        users.findOne({ where: { id: sortant.user.id } }),
      ).resolves.toMatchObject({ role: Role.STUDENT });
      await expect(
        users.findOne({ where: { id: entrant.user.id } }),
      ).resolves.toMatchObject({ role: Role.ADMIN });
    });

    it('épargne l’administration technique, qui n’a jamais été étudiante', async () => {
      // Un alumni est quelqu'un qui a été étudiant. Ce compte ne l'a jamais
      // été, et sa présence garantit qu'il reste quelqu'un aux commandes si
      // une bascule se passe mal.
      const { g2027 } = await preparerPassation();

      await activer(g2027).expect(201);

      await expect(
        users.findOne({ where: { id: admin.user.id } }),
      ).resolves.toMatchObject({ role: Role.ADMIN, promotion: null });
    });

    it('laisse le sortant se connecter, sans pouvoir administrer', async () => {
      // La rétrogradation retire les droits, elle ne supprime pas le compte :
      // l'ancien bureau reste membre de la plateforme.
      const { g2027 } = await preparerPassation();
      await activer(g2027).expect(201);

      await request(app.getHttpServer())
        .get('/api/v1/utilisateurs/moi')
        .set(sortant.entetes)
        .expect(200);

      await request(app.getHttpServer())
        .get(`${BUREAU}/postes`)
        .set(sortant.entetes)
        .expect(403);
    });
  });

  describe('page publique', () => {
    it('renvoie null tant qu’aucun mandat n’est actif', async () => {
      const reponse = await request(app.getHttpServer())
        .get(BUREAU)
        .expect(200);

      expect(reponse.body).toEqual({});
    });

    it('affiche la composition sans exposer les adresses', async () => {
      // La page est ouverte à tous : publier les adresses de la promotion les
      // livrerait aux robots collecteurs.
      const president = idDe(
        await creerPoste('Président', {
          estCle: true,
          accordeAdministration: true,
        }).expect(201),
      );
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));
      await affecter(generation, president, entrant.user.id).expect(201);
      await activer(generation).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(BUREAU)
        .expect(200);

      const corps = reponse.body as {
        nom: string;
        membres: Record<string, unknown>[];
      };
      expect(corps.nom).toBe('ATLAS');
      expect(corps.membres).toHaveLength(1);
      expect(corps.membres[0]).toMatchObject({ poste: 'Président' });
      expect(corps.membres[0]).not.toHaveProperty('email');
      expect(corps.membres[0]).not.toHaveProperty('id');
    });
  });

  describe('privileges de tresorerie', () => {
    // Ils existaient sur le poste et les gardes les appliquaient, mais aucun
    // DTO ne les exposait : ils n'etaient reglables que par ecriture directe
    // en base, et toute tentative par l'API se heurtait a un 400.
    it('accepte les privileges des la creation du poste', async () => {
      const reponse = await creerPoste('Tresoriere', {
        accedeTresorerie: true,
        autoriseRetrait: false,
      }).expect(201);

      expect(reponse.body).toMatchObject({
        accedeTresorerie: true,
        autoriseRetrait: false,
      });
    });

    it('laisse les deux privileges fermes par defaut', async () => {
      // Ouvrir par defaut donnerait acces aux comptes a tout le bureau.
      const reponse = await creerPoste('Charge des activites').expect(201);

      expect(reponse.body).toMatchObject({
        accedeTresorerie: false,
        autoriseRetrait: false,
      });
    });

    it('les regle aussi apres coup', async () => {
      const poste = idDe(
        await creerPoste('Commissaire aux comptes').expect(201),
      );

      const reponse = await request(app.getHttpServer())
        .patch(`${BUREAU}/postes/${poste}`)
        .set(admin.entetes)
        .send({ accedeTresorerie: true })
        .expect(200);

      // Lire les comptes et les vider ne relevent pas du meme risque : le
      // retrait reste ferme tant qu'on ne l'ouvre pas explicitement.
      expect(reponse.body).toMatchObject({
        accedeTresorerie: true,
        autoriseRetrait: false,
      });
    });
  });

  describe('administration en cours de mandat', () => {
    // La promotion se faisait au seul moment de la passation. Designer
    // quelqu'un sur un mandat deja actif — le cas courant — ne lui donnait
    // donc aucun droit, et le retirer ne lui en enlevait aucun.
    const posteAdmin = (nom: string) =>
      creerPoste(nom, { estCle: true, accordeAdministration: true });

    const roleDe = async (userId: string): Promise<Role> =>
      (await users.findOneByOrFail({ id: userId })).role;

    /** Cree un mandat actif, sans passer par l'activation. */
    const mandatActif = async (): Promise<string> => {
      const generation = await generations.save(
        generations.create({ annee: 2027, nom: 'ATLAS', isActive: true }),
      );
      return generation.id;
    };

    it('promeut le titulaire designe sur un mandat en cours', async () => {
      const generation = await mandatActif();
      const poste = idDe(await posteAdmin('President').expect(201));

      await expect(roleDe(entrant.user.id)).resolves.toBe(Role.STUDENT);

      await affecter(generation, poste, entrant.user.id).expect(201);

      await expect(roleDe(entrant.user.id)).resolves.toBe(Role.ADMIN);
    });

    it('ne promeut pas sur un poste qui n’accorde rien', async () => {
      const generation = await mandatActif();
      const poste = idDe(await creerPoste('Secretaire').expect(201));

      await affecter(generation, poste, entrant.user.id).expect(201);

      await expect(roleDe(entrant.user.id)).resolves.toBe(Role.STUDENT);
    });

    it('ne promeut pas d’avance sur un mandat inactif', async () => {
      // C'est l'activation qui tranchera : donner les cles a un bureau qui
      // n'est pas encore en fonction serait prematue.
      const generation = idDe(await creerGeneration(2027, 'ATLAS').expect(201));
      const poste = idDe(await posteAdmin('President').expect(201));

      await affecter(generation, poste, entrant.user.id).expect(201);

      await expect(roleDe(entrant.user.id)).resolves.toBe(Role.STUDENT);
    });

    it('retire l’administration au titulaire ecarte', async () => {
      const generation = await mandatActif();
      const poste = idDe(await posteAdmin('President').expect(201));
      const membre = idDe(
        await affecter(generation, poste, entrant.user.id).expect(201),
      );
      await expect(roleDe(entrant.user.id)).resolves.toBe(Role.ADMIN);

      await request(app.getHttpServer())
        .delete(`${BUREAU}/membres/${membre}`)
        .set(admin.entetes)
        .expect(204);

      await expect(roleDe(entrant.user.id)).resolves.toBe(Role.STUDENT);
    });

    it('garde l’administration a qui cumule un second poste', async () => {
      // Le role est recalcule a partir des postes detenus, jamais decremente :
      // en retirer un ne doit pas enlever ce que l'autre accorde.
      const generation = await mandatActif();
      const president = idDe(await posteAdmin('President').expect(201));
      const vice = idDe(await posteAdmin('Vice-president').expect(201));

      const premier = idDe(
        await affecter(generation, president, entrant.user.id).expect(201),
      );
      await affecter(generation, vice, entrant.user.id).expect(201);

      await request(app.getHttpServer())
        .delete(`${BUREAU}/membres/${premier}`)
        .set(admin.entetes)
        .expect(204);

      await expect(roleDe(entrant.user.id)).resolves.toBe(Role.ADMIN);
    });

    it('epargne l’administration technique, jamais etudiante', async () => {
      // Elle n'a pas de promotion : c'est elle qui garantit qu'il reste
      // quelqu'un aux commandes si une bascule se passe mal.
      const generation = await mandatActif();
      const poste = idDe(await posteAdmin('President').expect(201));
      const membre = idDe(
        await affecter(generation, poste, entrant.user.id).expect(201),
      );

      await request(app.getHttpServer())
        .delete(`${BUREAU}/membres/${membre}`)
        .set(admin.entetes)
        .expect(204);

      await expect(roleDe(admin.user.id)).resolves.toBe(Role.ADMIN);
    });
  });

  describe('logos du bureau', () => {
    const creerMandat = async (): Promise<string> =>
      idDe(await creerGeneration(2027, 'ATLAS').expect(201));

    const rattacher = (generation: string, logo: string) =>
      request(app.getHttpServer())
        .post(`${GENERATIONS}/${generation}/logos`)
        .set(admin.entetes)
        .send({ logo });

    it('n’accepte que des clés déposées avec l’usage logo', async () => {
      // Sans ce contrôle, n'importe quel objet du stockage pourrait habiller
      // le mandat — le CV d'un finissant, que les documents sortants iraient
      // alors lire.
      const generation = await creerMandat();

      await rattacher(generation, 'cv/dossier-awa.pdf').expect(400);
      await rattacher(generation, 'logos/clair.png').expect(201);
    });

    it('ne duplique pas une déclinaison redéposée', async () => {
      // Le frontend doit pouvoir rejouer l'appel après une coupure réseau.
      const generation = await creerMandat();

      await rattacher(generation, 'logos/clair.png').expect(201);
      const reponse = await rattacher(generation, 'logos/clair.png').expect(
        201,
      );

      expect((reponse.body as { logos: string[] }).logos).toEqual([
        'logos/clair.png',
      ]);
    });

    it('ne désigne qu’un logo effectivement déposé', async () => {
      // Sans ce contrôle, une faute de frappe afficherait une image
      // inexistante, et le bureau chercherait longtemps pourquoi.
      const generation = await creerMandat();
      await rattacher(generation, 'logos/clair.png').expect(201);
      await rattacher(generation, 'logos/sombre.png').expect(201);

      await request(app.getHttpServer())
        .patch(`${GENERATIONS}/${generation}/logo`)
        .set(admin.entetes)
        .send({ logo: 'logos/inexistant.png' })
        .expect(400);

      const reponse = await request(app.getHttpServer())
        .patch(`${GENERATIONS}/${generation}/logo`)
        .set(admin.entetes)
        .send({ logo: 'logos/sombre.png' })
        .expect(200);

      expect(reponse.body).toMatchObject({ logo: 'logos/sombre.png' });
    });

    it('retire une déclinaison sans toucher à celle qui habille le site', async () => {
      const generation = await creerMandat();
      await rattacher(generation, 'logos/clair.png').expect(201);
      await rattacher(generation, 'logos/sombre.png').expect(201);
      await request(app.getHttpServer())
        .patch(`${GENERATIONS}/${generation}/logo`)
        .set(admin.entetes)
        .send({ logo: 'logos/sombre.png' })
        .expect(200);

      const reponse = await request(app.getHttpServer())
        .delete(`${GENERATIONS}/${generation}/logos`)
        .query({ logo: 'logos/clair.png' })
        .set(admin.entetes)
        .expect(200);

      expect(reponse.body).toMatchObject({
        logos: ['logos/sombre.png'],
        logo: 'logos/sombre.png',
      });
    });

    it('lève la désignation en retirant le logo en service', async () => {
      // La plateforme retombe sur ses couleurs neutres plutôt que de pointer
      // vers un objet effacé.
      const generation = await creerMandat();
      await rattacher(generation, 'logos/clair.png').expect(201);
      await request(app.getHttpServer())
        .patch(`${GENERATIONS}/${generation}/logo`)
        .set(admin.entetes)
        .send({ logo: 'logos/clair.png' })
        .expect(200);

      const reponse = await request(app.getHttpServer())
        .delete(`${GENERATIONS}/${generation}/logos`)
        .query({ logo: 'logos/clair.png' })
        .set(admin.entetes)
        .expect(200);

      expect(reponse.body).toMatchObject({ logos: [], logo: null });
    });

    it('exige la clé à retirer', async () => {
      // Sans paramètre, la requête ne dit pas quoi effacer : mieux vaut un
      // refus explicite qu'une suppression devinée.
      const generation = await creerMandat();

      await request(app.getHttpServer())
        .delete(`${GENERATIONS}/${generation}/logos`)
        .set(admin.entetes)
        .expect(400);
    });

    it('refuse de retirer une déclinaison jamais déposée', async () => {
      const generation = await creerMandat();

      await request(app.getHttpServer())
        .delete(`${GENERATIONS}/${generation}/logos`)
        .query({ logo: 'logos/jamais-vue.png' })
        .set(admin.entetes)
        .expect(404);
    });
  });
});
