import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
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
        email: `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@entreprise.cm`,
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
});
