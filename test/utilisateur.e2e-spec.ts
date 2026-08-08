import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { MailService } from './../src/modules/mail/mail.service';
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
  relireAvecEmpreintes,
} from './utils/authentification';

const UTILISATEURS = '/api/v1/utilisateurs';
const MOI = `${UTILISATEURS}/moi`;
const MOT_DE_PASSE = 'phrase de passe actuelle 42';
const NOUVEAU = 'toute autre phrase de passe 99';

describe('Utilisateurs et profils (e2e)', () => {
  let app: INestApplication<App>;
  let users: Repository<User>;
  let admin: CompteDeTest;
  let etudiant: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
  };

  /** Compte disposant d'un vrai mot de passe, pour les tests de changement. */
  const avecMotDePasse = async (): Promise<CompteDeTest> => {
    const compte = await creerCompteAuthentifie(app);
    await users.update(compte.user.id, {
      passwordHash: await bcrypt.hash(MOT_DE_PASSE, 12),
    });
    return compte;
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

    users = app.get(getRepositoryToken(User));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await purgerUtilisateurs(app);

    admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
    etudiant = await creerCompteAuthentifie(app, { promotion: 2027 });
  });

  afterAll(async () => {
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('son profil', () => {
    it('ne renvoie aucun secret', async () => {
      // La réponse est construite champ par champ : une liste d'exclusion se
      // laisse oublier au premier champ sensible ajouté.
      const reponse = await request(app.getHttpServer())
        .get(MOI)
        .set(etudiant.entetes)
        .expect(200);

      const corps = reponse.body as Record<string, unknown>;
      expect(corps).toMatchObject({ promotion: 2027, role: Role.STUDENT });
      expect(corps).not.toHaveProperty('passwordHash');
      expect(corps).not.toHaveProperty('refreshTokenHash');
      expect(corps).not.toHaveProperty('emailVerifieLe');
    });

    it('modifie prénom, nom et photo', async () => {
      const reponse = await request(app.getHttpServer())
        .patch(MOI)
        .set(etudiant.entetes)
        .send({ prenom: 'Étienne', nom: 'Mayack', avatar: 'avatars/x.png' })
        .expect(200);

      expect(reponse.body).toMatchObject({
        prenom: 'Étienne',
        nom: 'Mayack',
        avatar: 'avatars/x.png',
      });
    });

    it.each(['role', 'promotion', 'isFinissant', 'email'])(
      'refuse de modifier « %s » depuis son profil',
      async (champ) => {
        // Le rôle ouvrirait l'administration, la promotion détermine le tarif
        // campus, le statut de finissant décide de l'annuaire, et l'adresse
        // sert d'identifiant de connexion.
        await request(app.getHttpServer())
          .patch(MOI)
          .set(etudiant.entetes)
          .send({ [champ]: champ === 'role' ? Role.ADMIN : 'valeur' })
          .expect(400);
      },
    );

    it('exige un jeton', async () => {
      await request(app.getHttpServer()).get(MOI).expect(401);
    });
  });

  describe('changement de mot de passe', () => {
    it('exige le mot de passe actuel', async () => {
      // Sans lui, un jeton volé suffirait à verrouiller le compte de son
      // propriétaire.
      const compte = await avecMotDePasse();

      await request(app.getHttpServer())
        .patch(`${MOI}/mot-de-passe`)
        .set(compte.entetes)
        .send({
          motDePasseActuel: 'ce nest pas le bon 42',
          nouveauMotDePasse: NOUVEAU,
        })
        .expect(401);
    });

    it('change le mot de passe et coupe les autres sessions', async () => {
      const compte = await avecMotDePasse();
      await users.update(compte.user.id, { refreshTokenHash: 'empreinte' });

      await request(app.getHttpServer())
        .patch(`${MOI}/mot-de-passe`)
        .set(compte.entetes)
        .send({ motDePasseActuel: MOT_DE_PASSE, nouveauMotDePasse: NOUVEAU })
        .expect(204);

      const misAJour = await relireAvecEmpreintes(app, compte.user.id);
      expect(await bcrypt.compare(NOUVEAU, misAJour.passwordHash!)).toBe(true);
      // Le changement de mot de passe est souvent la réaction à un accès
      // suspect : laisser les autres sessions ouvertes le viderait de son sens.
      expect(misAJour.refreshTokenHash).toBeNull();
    });

    it('refuse de reprendre le mot de passe actuel', async () => {
      const compte = await avecMotDePasse();

      await request(app.getHttpServer())
        .patch(`${MOI}/mot-de-passe`)
        .set(compte.entetes)
        .send({
          motDePasseActuel: MOT_DE_PASSE,
          nouveauMotDePasse: MOT_DE_PASSE,
        })
        .expect(400);
    });

    it('refuse un nouveau mot de passe trop court', async () => {
      const compte = await avecMotDePasse();

      await request(app.getHttpServer())
        .patch(`${MOI}/mot-de-passe`)
        .set(compte.entetes)
        .send({ motDePasseActuel: MOT_DE_PASSE, nouveauMotDePasse: 'court1' })
        .expect(400);
    });

    it('oriente un compte sans mot de passe vers son invitation', async () => {
      // Cas d'un sponsor invité qui n'a pas encore activé son accès.
      const sponsor = await creerCompteAuthentifie(app, { role: Role.SPONSOR });

      await request(app.getHttpServer())
        .patch(`${MOI}/mot-de-passe`)
        .set(sponsor.entetes)
        .send({
          motDePasseActuel: 'peu importe 42',
          nouveauMotDePasse: NOUVEAU,
        })
        .expect(400);
    });
  });

  describe('administration', () => {
    it('liste, filtre et recherche', async () => {
      await creerCompteAuthentifie(app, { promotion: 2025, prenom: 'Zoe' });

      const parPromotion = await request(app.getHttpServer())
        .get(UTILISATEURS)
        .query({ promotion: 2025 })
        .set(admin.entetes)
        .expect(200);
      expect(
        (parPromotion.body as { meta: { total: number } }).meta.total,
      ).toBe(1);

      const parRole = await request(app.getHttpServer())
        .get(UTILISATEURS)
        .query({ role: Role.ADMIN })
        .set(admin.entetes)
        .expect(200);
      expect((parRole.body as { meta: { total: number } }).meta.total).toBe(1);

      const parNom = await request(app.getHttpServer())
        .get(UTILISATEURS)
        .query({ recherche: 'zoe' })
        .set(admin.entetes)
        .expect(200);
      expect((parNom.body as { meta: { total: number } }).meta.total).toBe(1);
    });

    it('n’expose aucun secret dans la liste', async () => {
      const reponse = await request(app.getHttpServer())
        .get(UTILISATEURS)
        .set(admin.entetes)
        .expect(200);

      const donnees = (reponse.body as { donnees: Record<string, unknown>[] })
        .donnees;
      expect(donnees.length).toBeGreaterThan(0);
      expect(donnees.every((u) => !('passwordHash' in u))).toBe(true);
    });

    it('change le rôle d’un compte', async () => {
      const reponse = await request(app.getHttpServer())
        .patch(`${UTILISATEURS}/${etudiant.user.id}`)
        .set(admin.entetes)
        .send({ role: Role.ADMIN })
        .expect(200);

      expect(reponse.body).toMatchObject({ role: Role.ADMIN });
    });

    it('désactive sans effacer, et coupe la session', async () => {
      await users.update(etudiant.user.id, { refreshTokenHash: 'empreinte' });

      await request(app.getHttpServer())
        .patch(`${UTILISATEURS}/${etudiant.user.id}`)
        .set(admin.entetes)
        .send({ isActive: false })
        .expect(200);

      const compte = await relireAvecEmpreintes(app, etudiant.user.id);
      expect(compte.isActive).toBe(false);
      // Désactiver sans couper la session laisserait le compte agir jusqu'à
      // l'expiration de son jeton d'accès.
      expect(compte.refreshTokenHash).toBeNull();

      await request(app.getHttpServer())
        .get(MOI)
        .set(etudiant.entetes)
        .expect(401);
    });

    it('empêche un administrateur de se retirer son propre rôle', async () => {
      await request(app.getHttpServer())
        .patch(`${UTILISATEURS}/${admin.user.id}`)
        .set(admin.entetes)
        .send({ role: Role.STUDENT })
        .expect(403);
    });

    it('empêche un administrateur de se désactiver', async () => {
      await request(app.getHttpServer())
        .patch(`${UTILISATEURS}/${admin.user.id}`)
        .set(admin.entetes)
        .send({ isActive: false })
        .expect(403);
    });

    it('protège le dernier administrateur', async () => {
      // Sans ce garde-fou, il resterait zéro administrateur et la seule sortie
      // serait une intervention directe en base.
      const second = await creerCompteAuthentifie(app, { role: Role.ADMIN });

      await request(app.getHttpServer())
        .patch(`${UTILISATEURS}/${second.user.id}`)
        .set(admin.entetes)
        .send({ role: Role.STUDENT })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`${UTILISATEURS}/${admin.user.id}`)
        .set(second.entetes)
        .send({ role: Role.STUDENT })
        .expect(403);
    });

    it('est refusée à un étudiant', async () => {
      await request(app.getHttpServer())
        .get(UTILISATEURS)
        .set(etudiant.entetes)
        .expect(403);

      await request(app.getHttpServer())
        .patch(`${UTILISATEURS}/${admin.user.id}`)
        .set(etudiant.entetes)
        .send({ role: Role.STUDENT })
        .expect(403);
    });

    it('signale un compte inconnu', async () => {
      await request(app.getHttpServer())
        .get(`${UTILISATEURS}/00000000-0000-4000-8000-000000000000`)
        .set(admin.entetes)
        .expect(404);
    });
  });
});
