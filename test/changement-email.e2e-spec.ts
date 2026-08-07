import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { Generation } from './../src/modules/generation/entities/generation.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const DEMANDE = '/api/v1/utilisateurs/moi/email';
const CONFIRMATION = '/api/v1/auth/email/confirmer';
const MOT_DE_PASSE = 'phrase de passe actuelle 42';
const ANNEE_ACTIVE = 2027;

/**
 * Changer d'adresse, c'est changer d'identifiant de connexion.
 *
 * Deux garanties structurent ce parcours : le mot de passe actuel est exigé —
 * sinon un jeton volé suffirait à s'approprier le compte — et le lien part
 * vers la **nouvelle** adresse, seule façon de prouver qu'on y a accès.
 */
describe('Changement d’adresse (e2e)', () => {
  let app: INestApplication<App>;
  let users: Repository<User>;
  let generations: Repository<Generation>;
  let compte: CompteDeTest;

  /** Liens de confirmation captés, indexés par destinataire. */
  const confirmations = new Map<string, string>();
  const alertes: { to: string; nouvelle: string }[] = [];

  const faussaireMail = {
    envoyerConfirmationNouvelleAdresse: jest.fn(
      (to: string, _p: string, lien: string) => {
        confirmations.set(to, lien);
        return Promise.resolve();
      },
    ),
    envoyerAlerteChangementEmail: jest.fn(
      (to: string, _p: string, nouvelle: string) => {
        alertes.push({ to, nouvelle });
        return Promise.resolve();
      },
    ),
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
  };

  const jetonDe = (lien: string) =>
    decodeURIComponent(new URL(lien).searchParams.get('jeton') ?? '');

  const adresseExterne = () => `nouvelle.${randomUUID().slice(0, 8)}@gmail.com`;
  const adresseCampus = (promotion = ANNEE_ACTIVE) =>
    `nouvelle.${randomUUID().slice(0, 8)}@${promotion}.ucac-icam.com`;

  /** Compte disposant d'un vrai mot de passe. */
  const avecMotDePasse = async (
    options: Parameters<typeof creerCompteAuthentifie>[1] = {},
  ): Promise<CompteDeTest> => {
    const cree = await creerCompteAuthentifie(app, options);
    await users.update(cree.user.id, {
      passwordHash: await bcrypt.hash(MOT_DE_PASSE, 12),
    });
    return cree;
  };

  const demander = (
    entetes: { Authorization: string },
    email: string,
    motDePasse = MOT_DE_PASSE,
  ) =>
    request(app.getHttpServer())
      .patch(DEMANDE)
      .set(entetes)
      .send({ email, motDePasse });

  const confirmer = (jeton: string) =>
    request(app.getHttpServer()).post(CONFIRMATION).send({ jeton });

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

    users = app.get(getRepositoryToken(User));
    generations = app.get(getRepositoryToken(Generation));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    confirmations.clear();
    alertes.length = 0;
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);

    await generations.save(
      generations.create({
        annee: ANNEE_ACTIVE,
        nom: 'ATLAS',
        isActive: true,
      }),
    );

    compte = await avecMotDePasse({ role: Role.VISITOR });
  });

  afterAll(async () => {
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('demande', () => {
    it('exige le mot de passe actuel', async () => {
      // Sans lui, un jeton volé suffirait à s'approprier le compte : basculer
      // l'identifiant sur une adresse que l'on contrôle, puis demander une
      // réinitialisation de mot de passe.
      await demander(
        compte.entetes,
        adresseExterne(),
        'ce nest pas le bon 42',
      ).expect(401);

      expect(confirmations.size).toBe(0);
    });

    it('envoie le lien à la nouvelle adresse, et une alerte à l’ancienne', async () => {
      const nouvelle = adresseExterne();

      await demander(compte.entetes, nouvelle).expect(202);

      // Le lien part vers l'adresse demandée : c'est elle qu'il faut prouver.
      expect(confirmations.has(nouvelle)).toBe(true);
      expect(confirmations.has(compte.user.email)).toBe(false);

      // L'ancienne est prévenue, pour que le titulaire légitime puisse réagir.
      expect(alertes).toEqual([{ to: compte.user.email, nouvelle }]);
    });

    it('ne change rien tant que la nouvelle boîte n’a pas répondu', async () => {
      const nouvelle = adresseExterne();

      await demander(compte.entetes, nouvelle).expect(202);

      const enBase = await users.findOneOrFail({
        where: { id: compte.user.id },
      });
      expect(enBase.email).toBe(compte.user.email);
      expect(enBase.emailEnAttente).toBe(nouvelle);

      // La connexion continue de se faire avec l'ancienne adresse.
      await request(app.getHttpServer())
        .post('/api/v1/auth/connexion')
        .send({ email: compte.user.email, motDePasse: MOT_DE_PASSE })
        .expect(200);
    });

    it('refuse une adresse déjà utilisée', async () => {
      const autre = await creerCompteAuthentifie(app);

      await demander(compte.entetes, autre.user.email).expect(409);
    });

    it('refuse sa propre adresse', async () => {
      await demander(compte.entetes, compte.user.email).expect(400);
    });

    it('refuse une adresse mal formée', async () => {
      await demander(compte.entetes, 'pas-une-adresse').expect(400);
    });

    it('exige un jeton', async () => {
      await request(app.getHttpServer())
        .patch(DEMANDE)
        .send({ email: adresseExterne(), motDePasse: MOT_DE_PASSE })
        .expect(401);
    });

    it('oriente un compte sans mot de passe vers son invitation', async () => {
      const sponsor = await creerCompteAuthentifie(app, {
        role: Role.SPONSOR,
      });

      await demander(sponsor.entetes, adresseExterne()).expect(400);
    });
  });

  describe('confirmation', () => {
    it('bascule l’adresse et coupe les sessions', async () => {
      const nouvelle = adresseExterne();
      await users.update(compte.user.id, { refreshTokenHash: 'empreinte' });
      await demander(compte.entetes, nouvelle).expect(202);

      const reponse = await confirmer(
        jetonDe(confirmations.get(nouvelle)!),
      ).expect(200);

      expect(reponse.body).toHaveProperty('accessToken');

      const enBase = await users.findOneOrFail({
        where: { id: compte.user.id },
      });
      expect(enBase.email).toBe(nouvelle);
      expect(enBase.emailEnAttente).toBeNull();
      expect(enBase.emailVerifieLe).not.toBeNull();
      // L'identifiant de connexion change : les sessions ouvertes ailleurs
      // n'ont plus lieu d'etre. L'empreinte n'est pas nulle pour autant — la
      // confirmation ouvre aussitot une session pour qui vient de cliquer —
      // mais ce n'est plus la meme, donc l'ancienne ne vaut plus rien.
      expect(enBase.refreshTokenHash).not.toBe('empreinte');

      await request(app.getHttpServer())
        .post('/api/v1/auth/connexion')
        .send({ email: nouvelle, motDePasse: MOT_DE_PASSE })
        .expect(200);
    });

    it('refuse un lien déjà utilisé', async () => {
      const nouvelle = adresseExterne();
      await demander(compte.entetes, nouvelle).expect(202);
      const jeton = jetonDe(confirmations.get(nouvelle)!);

      await confirmer(jeton).expect(200);
      await confirmer(jeton).expect(400);
    });

    it('refuse un jeton inconnu', async () => {
      await confirmer('jeton-invente-de-toutes-pieces').expect(400);
    });

    it('révoque le lien précédent si une nouvelle demande est faite', async () => {
      const premiere = adresseExterne();
      await demander(compte.entetes, premiere).expect(202);
      const ancienJeton = jetonDe(confirmations.get(premiere)!);

      const seconde = adresseExterne();
      await demander(compte.entetes, seconde).expect(202);

      // Une adresse saisie par erreur ne doit pas rester confirmable.
      await confirmer(ancienJeton).expect(400);
      await confirmer(jetonDe(confirmations.get(seconde)!)).expect(200);

      await expect(
        users.findOneOrFail({ where: { id: compte.user.id } }),
      ).resolves.toMatchObject({ email: seconde });
    });

    it('signale une adresse prise entre-temps', async () => {
      const nouvelle = adresseExterne();
      await demander(compte.entetes, nouvelle).expect(202);

      // Quelqu'un s'inscrit avec cette adresse entre la demande et le clic.
      await users.save(
        users.create({
          email: nouvelle,
          firstName: 'Plus',
          lastName: 'Rapide',
          role: Role.VISITOR,
          emailVerifieLe: new Date(),
        }),
      );

      await confirmer(jetonDe(confirmations.get(nouvelle)!)).expect(409);

      // La demande est abandonnée plutôt que laissée en suspens.
      await expect(
        users.findOneOrFail({ where: { id: compte.user.id } }),
      ).resolves.toMatchObject({ emailEnAttente: null });
    });
  });

  describe('attributs déduits de la nouvelle adresse', () => {
    it('accorde le statut étudiant à une adresse institutionnelle', async () => {
      // Prouver la possession d'une adresse institutionnelle vaut exactement
      // ce que vaut la vérification initiale.
      const nouvelle = adresseCampus();
      await demander(compte.entetes, nouvelle).expect(202);

      await confirmer(jetonDe(confirmations.get(nouvelle)!)).expect(200);

      await expect(
        users.findOneOrFail({ where: { id: compte.user.id } }),
      ).resolves.toMatchObject({
        role: Role.STUDENT,
        promotion: ANNEE_ACTIVE,
        isFinissant: true,
      });
    });

    it('retire le statut étudiant en passant à une adresse externe', async () => {
      const etudiant = await avecMotDePasse({ promotion: ANNEE_ACTIVE });
      const nouvelle = adresseExterne();
      await demander(etudiant.entetes, nouvelle).expect(202);

      await confirmer(jetonDe(confirmations.get(nouvelle)!)).expect(200);

      await expect(
        users.findOneOrFail({ where: { id: etudiant.user.id } }),
      ).resolves.toMatchObject({
        role: Role.VISITOR,
        promotion: null,
        isFinissant: false,
      });
    });

    it('ne rétrograde pas un administrateur', async () => {
      // Le rôle vient du bureau, pas d'un nom de domaine : sans cette réserve,
      // un membre du bureau perdrait ses droits en changeant d'adresse.
      const admin = await avecMotDePasse({ role: Role.ADMIN, promotion: null });
      const nouvelle = adresseExterne();
      await demander(admin.entetes, nouvelle).expect(202);

      await confirmer(jetonDe(confirmations.get(nouvelle)!)).expect(200);

      await expect(
        users.findOneOrFail({ where: { id: admin.user.id } }),
      ).resolves.toMatchObject({ role: Role.ADMIN, email: nouvelle });
    });

    it('ne rétrograde pas un partenaire', async () => {
      // Son rôle vient d'un partenariat négocié hors de la plateforme.
      const sponsor = await avecMotDePasse({ role: Role.SPONSOR });
      const nouvelle = adresseCampus();
      await demander(sponsor.entetes, nouvelle).expect(202);

      await confirmer(jetonDe(confirmations.get(nouvelle)!)).expect(200);

      await expect(
        users.findOneOrFail({ where: { id: sponsor.user.id } }),
      ).resolves.toMatchObject({ role: Role.SPONSOR });
    });

    it('met à jour la promotion d’une adresse institutionnelle à l’autre', async () => {
      const etudiant = await avecMotDePasse({ promotion: 2026 });
      const nouvelle = adresseCampus(ANNEE_ACTIVE);
      await demander(etudiant.entetes, nouvelle).expect(202);

      await confirmer(jetonDe(confirmations.get(nouvelle)!)).expect(200);

      await expect(
        users.findOneOrFail({ where: { id: etudiant.user.id } }),
      ).resolves.toMatchObject({
        promotion: ANNEE_ACTIVE,
        isFinissant: true,
      });
    });
  });
});
