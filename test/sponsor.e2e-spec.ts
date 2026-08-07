import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { MailService } from './../src/modules/mail/mail.service';
import { PalierSponsor } from './../src/modules/sponsor/entities/palier-sponsor.entity';
import { Sponsor } from './../src/modules/sponsor/entities/sponsor.entity';
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

/**
 * Invitation d'un partenaire par le bureau.
 *
 * Le point sensible est le compte créé sans mot de passe : il ne doit jamais
 * pouvoir se connecter avant que le partenaire ait suivi son lien.
 */
describe('Sponsors (e2e)', () => {
  let app: INestApplication<App>;
  let sponsors: Repository<Sponsor>;
  let paliers: Repository<PalierSponsor>;
  let users: Repository<User>;
  let admin: CompteDeTest;
  let etudiant: CompteDeTest;

  const invitations: { to: string; nom: string; lien: string }[] = [];

  const faussaireMail = {
    envoyerInvitationSponsor: jest.fn(
      (to: string, nom: string, lien: string) => {
        invitations.push({ to, nom, lien });
        return Promise.resolve();
      },
    ),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
  };

  const SPONSORS = '/api/v1/sponsors';
  const ACTIVATION = '/api/v1/auth/invitation/activer';
  const MOT_DE_PASSE = 'phrase de passe partenaire 42';
  const jetonDe = (lien: string) =>
    decodeURIComponent(new URL(lien).searchParams.get('jeton') ?? '');

  const inviter = (surcharge: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(SPONSORS)
      .set(admin.entetes)
      .send({
        nom: 'Groupe Partenaire',
        email: `contact-${randomUUID().slice(0, 8)}@entreprise.cm`,
        ...surcharge,
      });

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

    sponsors = app.get(getRepositoryToken(Sponsor));
    paliers = app.get(getRepositoryToken(PalierSponsor));
    users = app.get(getRepositoryToken(User));
  });

  beforeEach(async () => {
    invitations.length = 0;
    jest.clearAllMocks();
    await sponsors.createQueryBuilder().delete().execute();
    await paliers.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);

    admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
    etudiant = await creerCompteAuthentifie(app, { role: Role.STUDENT });
  });

  afterAll(async () => {
    await sponsors.createQueryBuilder().delete().execute();
    await paliers.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('autorisation', () => {
    it('refuse l’invitation à un étudiant', async () => {
      await request(app.getHttpServer())
        .post(SPONSORS)
        .set(etudiant.entetes)
        .send({ nom: 'Intrus', email: 'intrus@entreprise.cm' })
        .expect(403);
    });

    it('refuse sans jeton', async () => {
      await request(app.getHttpServer())
        .post(SPONSORS)
        .send({ nom: 'Anonyme', email: 'anonyme@entreprise.cm' })
        .expect(401);
    });
  });

  describe('invitation', () => {
    it('crée le partenaire et envoie le lien', async () => {
      const reponse = await inviter({ secteur: 'Ingénierie' }).expect(201);

      const corps = reponse.body as { id: string; nom: string };
      expect(corps.nom).toBe('Groupe Partenaire');
      expect(invitations).toHaveLength(1);
      expect(invitations[0].lien).toContain('jeton=');
    });

    it('crée un compte sans mot de passe, incapable de se connecter', async () => {
      // Le bureau ne génère ni ne transmet aucun mot de passe : un mot de
      // passe envoyé par mail est lisible par quiconque accède à la boîte.
      const reponse = await inviter().expect(201);
      const email = (reponse.body as { email: string }).email;

      const compte = await users.findOne({ where: { email } });
      expect(compte).toMatchObject({
        role: Role.SPONSOR,
        passwordHash: null,
        emailVerifieLe: null,
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/connexion')
        .send({ email, motDePasse: 'nimporte quelle phrase 42' })
        .expect(401);
    });

    it('normalise l’adresse', async () => {
      const reponse = await inviter({
        email: '  Contact.Pro+Devis@Entreprise.CM  ',
      }).expect(201);

      expect((reponse.body as { email: string }).email).toBe(
        'contact.pro@entreprise.cm',
      );
    });

    it('refuse une adresse déjà utilisée', async () => {
      // Rattacher donnerait le rôle SPONSOR à un compte existant — ici un
      // étudiant — et lui ouvrirait l'annuaire des finissants.
      await request(app.getHttpServer())
        .post(SPONSORS)
        .set(admin.entetes)
        .send({ nom: 'Doublon', email: etudiant.user.email })
        .expect(409);

      expect(invitations).toHaveLength(0);
    });

    it('rattache un palier existant', async () => {
      const palier = await paliers.save(
        paliers.create({ nom: 'Or', ordre: 1, accesAnnuaire: true }),
      );

      const reponse = await inviter({ palierId: palier.id }).expect(201);
      const sponsor = await sponsors.findOne({
        where: { id: (reponse.body as { id: string }).id },
        relations: { palier: true },
      });

      expect(sponsor?.palier?.nom).toBe('Or');
    });

    it('refuse un palier inexistant sans créer le partenaire', async () => {
      await inviter({
        palierId: '00000000-0000-4000-8000-000000000000',
      }).expect(404);

      await expect(sponsors.count()).resolves.toBe(0);
      await expect(users.countBy({ role: Role.SPONSOR })).resolves.toBe(0);
    });

    it('refuse une adresse mal formée', async () => {
      await inviter({ email: 'pas-une-adresse' }).expect(400);
    });
  });

  describe('activation', () => {
    it('permet au partenaire de choisir son mot de passe et de se connecter', async () => {
      const reponse = await inviter().expect(201);
      const email = (reponse.body as { email: string }).email;

      await request(app.getHttpServer())
        .post(ACTIVATION)
        .send({ jeton: jetonDe(invitations[0].lien), motDePasse: MOT_DE_PASSE })
        .expect(200);

      // Le clic vaut confirmation de l'adresse : le partenaire n'a pas à
      // recevoir un second mail de vérification.
      await expect(users.findOne({ where: { email } })).resolves.toMatchObject({
        role: Role.SPONSOR,
      });

      await request(app.getHttpServer())
        .post('/api/v1/auth/connexion')
        .send({ email, motDePasse: MOT_DE_PASSE })
        .expect(200);
    });

    it('ne laisse pas rejouer le lien d’activation', async () => {
      await inviter().expect(201);
      const jeton = jetonDe(invitations[0].lien);

      await request(app.getHttpServer())
        .post(ACTIVATION)
        .send({ jeton, motDePasse: MOT_DE_PASSE })
        .expect(200);

      await request(app.getHttpServer())
        .post(ACTIVATION)
        .send({ jeton, motDePasse: 'une autre phrase de passe 42' })
        .expect(400);
    });
  });

  describe('réinvitation', () => {
    it('révoque le lien précédent', async () => {
      const reponse = await inviter().expect(201);
      const premier = jetonDe(invitations[0].lien);

      await request(app.getHttpServer())
        .post(`${SPONSORS}/${(reponse.body as { id: string }).id}/reinviter`)
        .set(admin.entetes)
        .expect(204);

      expect(invitations).toHaveLength(2);

      // Le premier lien a pu être communiqué par erreur : réémettre doit le
      // rendre inutilisable.
      await request(app.getHttpServer())
        .post(ACTIVATION)
        .send({ jeton: premier, motDePasse: MOT_DE_PASSE })
        .expect(400);

      await request(app.getHttpServer())
        .post(ACTIVATION)
        .send({ jeton: jetonDe(invitations[1].lien), motDePasse: MOT_DE_PASSE })
        .expect(200);
    });

    it('refuse de réinviter un accès déjà activé', async () => {
      const reponse = await inviter().expect(201);
      await request(app.getHttpServer())
        .post(ACTIVATION)
        .send({ jeton: jetonDe(invitations[0].lien), motDePasse: MOT_DE_PASSE })
        .expect(200);

      await request(app.getHttpServer())
        .post(`${SPONSORS}/${(reponse.body as { id: string }).id}/reinviter`)
        .set(admin.entetes)
        .expect(409);
    });

    it('signale un partenaire inconnu', async () => {
      await request(app.getHttpServer())
        .post(`${SPONSORS}/00000000-0000-4000-8000-000000000000/reinviter`)
        .set(admin.entetes)
        .expect(404);
    });
  });

  describe('liste', () => {
    it('pagine les partenaires', async () => {
      await inviter({ nom: 'Alpha' }).expect(201);
      await inviter({ nom: 'Beta' }).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(SPONSORS)
        .query({ limite: 1, tri: 'nom', ordre: 'asc' })
        .set(admin.entetes)
        .expect(200);

      const corps = reponse.body as {
        donnees: { nom: string }[];
        meta: { total: number; aSuivante: boolean };
      };
      expect(corps.donnees).toHaveLength(1);
      expect(corps.donnees[0].nom).toBe('Alpha');
      expect(corps.meta).toMatchObject({ total: 2, aSuivante: true });
    });

    it('refuse la liste à un étudiant', async () => {
      await request(app.getHttpServer())
        .get(SPONSORS)
        .set(etudiant.entetes)
        .expect(403);
    });
  });
  describe('vitrine publique', () => {
    it('est accessible sans jeton et masque les données commerciales', async () => {
      // Ni email, ni quotas, ni statistiques : les exposer sur une page
      // ouverte livrerait les contacts de tous les partenaires aux robots.
      await inviter({ nom: 'Alpha', secteur: 'Ingénierie' }).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${SPONSORS}/publics`)
        .expect(200);

      const corps = reponse.body as Record<string, unknown>[];
      expect(corps).toHaveLength(1);
      expect(corps[0]).toMatchObject({ nom: 'Alpha', secteur: 'Ingénierie' });
      expect(corps[0]).not.toHaveProperty('email');
      expect(corps[0]).not.toHaveProperty('stats');
      expect(corps[0]).not.toHaveProperty('user');
      expect(corps[0]).not.toHaveProperty('quotasPersonnalises');
    });

    it('classe par palier, puis par nom', async () => {
      const or = await paliers.save(paliers.create({ nom: 'Or', ordre: 1 }));
      const argent = await paliers.save(
        paliers.create({ nom: 'Argent', ordre: 2 }),
      );

      await inviter({ nom: 'Zeta', palierId: or.id }).expect(201);
      await inviter({ nom: 'Alpha', palierId: argent.id }).expect(201);
      await inviter({ nom: 'Beta', palierId: argent.id }).expect(201);
      // Sans palier : doit finir en queue de liste, pas en tête.
      await inviter({ nom: 'Aaa' }).expect(201);

      const reponse = await request(app.getHttpServer())
        .get(`${SPONSORS}/publics`)
        .expect(200);

      expect((reponse.body as { nom: string }[]).map((s) => s.nom)).toEqual([
        'Zeta',
        'Alpha',
        'Beta',
        'Aaa',
      ]);
    });
  });

  describe('espace partenaire', () => {
    /** Invite un partenaire, active son accès, et renvoie ses en-têtes. */
    const partenaireActif = async () => {
      const reponse = await inviter({ nom: 'Partenaire Actif' }).expect(201);
      const activation = await request(app.getHttpServer())
        .post(ACTIVATION)
        .send({
          jeton: jetonDe(invitations[invitations.length - 1].lien),
          motDePasse: MOT_DE_PASSE,
        })
        .expect(200);

      const { accessToken } = activation.body as { accessToken: string };
      return {
        id: (reponse.body as { id: string }).id,
        entetes: { Authorization: `Bearer ${accessToken}` },
      };
    };

    it('permet au partenaire de consulter et modifier sa fiche', async () => {
      const partenaire = await partenaireActif();

      await request(app.getHttpServer())
        .get(`${SPONSORS}/moi`)
        .set(partenaire.entetes)
        .expect(200);

      const reponse = await request(app.getHttpServer())
        .patch(`${SPONSORS}/moi`)
        .set(partenaire.entetes)
        .send({ description: 'Cabinet de conseil en ingénierie.' })
        .expect(200);

      expect(reponse.body).toMatchObject({
        description: 'Cabinet de conseil en ingénierie.',
      });
    });

    it('n’expose pas le palier à la modification par le partenaire', async () => {
      // Le palier ouvre l'accès à l'annuaire des finissants : un partenaire
      // pourrait sinon s'accorder les droits du palier supérieur.
      const or = await paliers.save(paliers.create({ nom: 'Or', ordre: 1 }));
      const partenaire = await partenaireActif();

      await request(app.getHttpServer())
        .patch(`${SPONSORS}/moi`)
        .set(partenaire.entetes)
        .send({ palierId: or.id })
        .expect(400);
    });

    it('n’expose pas l’adresse à la modification', async () => {
      // Elle sert d'identifiant de connexion : la changer ici déconnecterait
      // le partenaire de son compte sans qu'il en soit averti.
      const partenaire = await partenaireActif();

      await request(app.getHttpServer())
        .patch(`${SPONSORS}/moi`)
        .set(partenaire.entetes)
        .send({ email: 'autre@entreprise.cm' })
        .expect(400);
    });

    it('refuse l’espace partenaire à un étudiant', async () => {
      await request(app.getHttpServer())
        .get(`${SPONSORS}/moi`)
        .set(etudiant.entetes)
        .expect(403);
    });
  });

  describe('administration des partenaires', () => {
    it('consulte et modifie une fiche', async () => {
      const reponse = await inviter().expect(201);
      const id = (reponse.body as { id: string }).id;

      await request(app.getHttpServer())
        .get(`${SPONSORS}/${id}`)
        .set(admin.entetes)
        .expect(200);

      const modifiee = await request(app.getHttpServer())
        .patch(`${SPONSORS}/${id}`)
        .set(admin.entetes)
        .send({ nom: 'Nouveau nom' })
        .expect(200);

      expect(modifiee.body).toMatchObject({ nom: 'Nouveau nom' });
    });

    it('change le palier par l’endpoint dédié', async () => {
      const or = await paliers.save(paliers.create({ nom: 'Or', ordre: 1 }));
      const reponse = await inviter().expect(201);

      const modifiee = await request(app.getHttpServer())
        .patch(`${SPONSORS}/${(reponse.body as { id: string }).id}/palier`)
        .set(admin.entetes)
        .send({ palierId: or.id })
        .expect(200);

      expect((modifiee.body as { palier: { nom: string } }).palier.nom).toBe(
        'Or',
      );
    });

    it('supprime la fiche et le compte de connexion associé', async () => {
      // Laisser le compte derrière créerait un utilisateur au rôle SPONSOR
      // sans partenaire associé, capable de se connecter sans raison visible.
      const reponse = await inviter().expect(201);
      const corps = reponse.body as { id: string; email: string };

      await request(app.getHttpServer())
        .delete(`${SPONSORS}/${corps.id}`)
        .set(admin.entetes)
        .expect(204);

      await expect(sponsors.countBy({ id: corps.id })).resolves.toBe(0);
      await expect(users.countBy({ email: corps.email })).resolves.toBe(0);
    });

    it('signale une fiche inconnue', async () => {
      await request(app.getHttpServer())
        .get(`${SPONSORS}/00000000-0000-4000-8000-000000000000`)
        .set(admin.entetes)
        .expect(404);
    });
  });

  describe('paliers', () => {
    const PALIERS = `${SPONSORS}/paliers`;

    it('crée, liste et modifie un palier', async () => {
      const cree = await request(app.getHttpServer())
        .post(PALIERS)
        .set(admin.entetes)
        .send({ nom: 'Or', ordre: 1, accesAnnuaire: true })
        .expect(201);

      const id = (cree.body as { id: string }).id;

      const liste = await request(app.getHttpServer())
        .get(PALIERS)
        .set(admin.entetes)
        .expect(200);
      expect(liste.body as unknown[]).toHaveLength(1);

      const modifie = await request(app.getHttpServer())
        .patch(`${PALIERS}/${id}`)
        .set(admin.entetes)
        .send({ maxTelechargementsCv: 25 })
        .expect(200);
      expect(modifie.body).toMatchObject({ maxTelechargementsCv: 25 });
    });

    it('refuse de supprimer un palier encore utilisé', async () => {
      // La relation étant en SET NULL, la suppression retirerait
      // silencieusement les droits d'annuaire du partenaire.
      const cree = await request(app.getHttpServer())
        .post(PALIERS)
        .set(admin.entetes)
        .send({ nom: 'Or', ordre: 1 })
        .expect(201);
      const id = (cree.body as { id: string }).id;

      await inviter({ palierId: id }).expect(201);

      await request(app.getHttpServer())
        .delete(`${PALIERS}/${id}`)
        .set(admin.entetes)
        .expect(409);
    });

    it('supprime un palier libre de tout partenaire', async () => {
      const cree = await request(app.getHttpServer())
        .post(PALIERS)
        .set(admin.entetes)
        .send({ nom: 'Bronze', ordre: 3 })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`${PALIERS}/${(cree.body as { id: string }).id}`)
        .set(admin.entetes)
        .expect(204);

      await expect(paliers.count()).resolves.toBe(0);
    });

    it('refuse la gestion des paliers à un étudiant', async () => {
      await request(app.getHttpServer())
        .get(PALIERS)
        .set(etudiant.entetes)
        .expect(403);
    });
  });
});
