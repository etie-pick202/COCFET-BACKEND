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
import { User } from './../src/modules/user/entities/user.entity';

/**
 * Parcours complet d'authentification, contre une vraie base.
 *
 * Le service d'email est remplacé par un espion : c'est le seul moyen de
 * récupérer le lien de vérification, puisque le jeton n'est jamais stocké en
 * clair. C'est aussi ce qui permet de vérifier **quel** email part dans chaque
 * situation, ce qui porte ici une partie de la sécurité.
 */
describe('Authentification (e2e)', () => {
  let app: INestApplication<App>;
  let users: Repository<User>;
  let generations: Repository<Generation>;

  /** Liens capturés, indexés par destinataire. */
  const liensVerification = new Map<string, string>();
  const tentativesSignalees: string[] = [];

  const MOT_DE_PASSE = 'motdepasse-de-test-42';

  const faussaireMail = {
    envoyerVerificationEmail: jest.fn(
      (to: string, _p: string, lien: string) => {
        liensVerification.set(to, lien);
        return Promise.resolve();
      },
    ),
    envoyerTentativeInscription: jest.fn((to: string) => {
      tentativesSignalees.push(to);
      return Promise.resolve();
    }),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
  };

  const jetonDepuisLien = (lien: string): string =>
    decodeURIComponent(new URL(lien).searchParams.get('jeton') ?? '');

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

    users = moduleFixture.get(getRepositoryToken(User));
    generations = moduleFixture.get(getRepositoryToken(Generation));

    await generations.save(
      generations.create({
        annee: 2027,
        nom: 'Promotion 2027 (test)',
        isActive: true,
        stats: {},
      }),
    );
  });

  afterAll(async () => {
    await users.createQueryBuilder().delete().execute();
    await generations.createQueryBuilder().delete().execute();
    await app.close();
  });

  const inscrire = (email: string, motDePasse = MOT_DE_PASSE) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/inscription')
      .send({ email, motDePasse, prenom: 'Etienne', nom: 'Mayack' });

  const connecter = (email: string, motDePasse = MOT_DE_PASSE) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/connexion')
      .send({ email, motDePasse });

  describe("parcours d'un étudiant", () => {
    const EMAIL = 'etienne.mayack@2027.ucac-icam.com';

    it('accepte l’inscription', async () => {
      await inscrire(EMAIL).expect(202);
      expect(liensVerification.has(EMAIL)).toBe(true);
    });

    it('refuse la connexion tant que l’adresse n’est pas confirmée', async () => {
      const reponse = await connecter(EMAIL).expect(401);
      expect((reponse.body as { code: string }).code).toBe('NON_AUTHENTIFIE');
    });

    it('reste visiteur sans promotion avant confirmation', async () => {
      const user = await users.findOneOrFail({ where: { email: EMAIL } });
      expect(user.role).toBe(Role.VISITOR);
      expect(user.promotion).toBeNull();
      expect(user.emailVerifieLe).toBeNull();
    });

    it('devient étudiant finissant après confirmation', async () => {
      const jeton = jetonDepuisLien(liensVerification.get(EMAIL) as string);

      const reponse = await request(app.getHttpServer())
        .post('/api/v1/auth/verification-email')
        .send({ jeton })
        .expect(200);

      expect(
        (reponse.body as { accessToken: string }).accessToken,
      ).toBeDefined();

      const user = await users.findOneOrFail({ where: { email: EMAIL } });
      expect(user.role).toBe(Role.STUDENT);
      expect(user.promotion).toBe(2027);
      expect(user.isFinissant).toBe(true);
    });

    it('refuse le même jeton une seconde fois', async () => {
      const jeton = jetonDepuisLien(liensVerification.get(EMAIL) as string);

      await request(app.getHttpServer())
        .post('/api/v1/auth/verification-email')
        .send({ jeton })
        .expect(400);
    });

    it('autorise la connexion une fois confirmée', async () => {
      const reponse = await connecter(EMAIL).expect(200);
      const corps = reponse.body as {
        accessToken: string;
        refreshToken: string;
      };
      expect(corps.accessToken).toBeDefined();
      expect(corps.refreshToken).toBeDefined();
    });

    it('renouvelle la session et invalide le jeton précédent', async () => {
      const reponse = await connecter(EMAIL).expect(200);
      const ancien = (reponse.body as { refreshToken: string }).refreshToken;

      await request(app.getHttpServer())
        .post('/api/v1/auth/rafraichir')
        .send({ refreshToken: ancien })
        .expect(200);

      // Rejouer l'ancien jeton doit échouer : c'est ce qui limite l'impact d'un vol.
      await request(app.getHttpServer())
        .post('/api/v1/auth/rafraichir')
        .send({ refreshToken: ancien })
        .expect(401);
    });
  });

  describe('protection des comptes', () => {
    const EMAIL = 'victime@2027.ucac-icam.com';

    it('ne modifie pas un compte confirmé et signale la tentative', async () => {
      await inscrire(EMAIL).expect(202);
      const jeton = jetonDepuisLien(liensVerification.get(EMAIL) as string);
      await request(app.getHttpServer())
        .post('/api/v1/auth/verification-email')
        .send({ jeton })
        .expect(200);

      liensVerification.delete(EMAIL);
      tentativesSignalees.length = 0;

      // Un tiers tente de s'inscrire avec la même adresse.
      await inscrire(EMAIL, 'mot-de-passe-du-pirate-42').expect(202);

      expect(tentativesSignalees).toContain(EMAIL);
      // Aucun lien envoyé : il permettrait de prendre le compte.
      expect(liensVerification.has(EMAIL)).toBe(false);
      // Le mot de passe d'origine fonctionne toujours.
      await connecter(EMAIL).expect(200);
    });

    it('renvoie la même réponse pour une adresse libre et une adresse prise', async () => {
      const libre = await inscrire('inconnu.total@gmail.com').expect(202);
      const prise = await inscrire(EMAIL).expect(202);

      expect(libre.body).toEqual(prise.body);
    });

    it('normalise l’adresse : le suffixe + ne crée pas un second compte', async () => {
      const avant = await users.count();
      await inscrire('etienne.mayack+bis@2027.ucac-icam.com').expect(202);
      expect(await users.count()).toBe(avant);
    });
  });

  describe('validation des entrées', () => {
    it('refuse un mot de passe trop court, en nommant le champ', async () => {
      const reponse = await request(app.getHttpServer())
        .post('/api/v1/auth/inscription')
        .send({
          email: 'court@gmail.com',
          motDePasse: 'court',
          prenom: 'A',
          nom: 'B',
        })
        .expect(400);

      const corps = reponse.body as {
        code: string;
        champs: Record<string, string[]>;
      };
      expect(corps.code).toBe('VALIDATION');
      expect(corps.champs.motDePasse).toBeDefined();
    });

    it('refuse une adresse malformée', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/inscription')
        .send({
          email: 'pas-une-adresse',
          motDePasse: MOT_DE_PASSE,
          prenom: 'A',
          nom: 'B',
        })
        .expect(400);
    });

    it('rejette un champ inconnu plutôt que de l’ignorer', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/inscription')
        .send({
          email: 'x@gmail.com',
          motDePasse: MOT_DE_PASSE,
          prenom: 'A',
          nom: 'B',
          role: 'ADMIN',
        })
        .expect(400);
    });
  });

  describe('routes protégées', () => {
    it('refuse la déconnexion sans jeton', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/deconnexion')
        .expect(401);
    });

    it('accepte la déconnexion avec un jeton valide', async () => {
      const reponse = await connecter(
        'etienne.mayack@2027.ucac-icam.com',
      ).expect(200);
      const { accessToken } = reponse.body as { accessToken: string };

      await request(app.getHttpServer())
        .post('/api/v1/auth/deconnexion')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);
    });
  });
});
