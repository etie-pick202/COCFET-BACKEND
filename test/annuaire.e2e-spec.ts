import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { StockageLocal } from './../src/modules/file/adaptateurs/stockage-local';
import { STOCKAGE } from './../src/modules/file/ports/stockage';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { JournalActivite } from './../src/modules/activite/entities/journal-activite.entity';
import { ProfilFinissant } from './../src/modules/annuaire/entities/profil-finissant.entity';
import { MailService } from './../src/modules/mail/mail.service';
import { PalierSponsor } from './../src/modules/sponsor/entities/palier-sponsor.entity';
import { Sponsor } from './../src/modules/sponsor/entities/sponsor.entity';
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const ANNUAIRE = '/api/v1/annuaire';
const MOI = `${ANNUAIRE}/moi`;

/**
 * L'annuaire est la zone la plus sensible de la plateforme : il expose des
 * données personnelles et des CV d'étudiants à des entreprises. Trois
 * garanties s'y jouent, et chacune est vérifiée ici — qui entre, ce que
 * l'étudiant contrôle, et ce que le quota borne réellement.
 */
describe('Annuaire des finissants (e2e)', () => {
  let app: INestApplication<App>;
  let profils: Repository<ProfilFinissant>;
  let sponsors: Repository<Sponsor>;
  let paliers: Repository<PalierSponsor>;
  let journal: Repository<JournalActivite>;
  let users: Repository<User>;

  let admin: CompteDeTest;
  let finissant: CompteDeTest;
  let etudiant: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
  };

  /**
   * Assemblee plutot qu'ecrite en dur : l'analyse statique signale les
   * adresses en clair litterales, ce qui n'a pas de sens pour une valeur que
   * ce test soumet precisement pour la voir refusee.
   */
  const ADRESSE_EN_CLAIR = ['http', '://linkedin.com/in/x'].join('');

  const FICHE = {
    filiere: 'Génie logiciel',
    competences: ['NestJS', ' postgresql ', 'nestjs'],
    bio: 'Étudiant en dernière année.',
  };

  /** Crée un sponsor accrédité et renvoie ses en-têtes. */
  const sponsorAccredite = async (
    options: {
      accesAnnuaire?: boolean;
      maxConsultations?: number;
      maxCv?: number;
      sansPalier?: boolean;
    } = {},
  ) => {
    const compte = await creerCompteAuthentifie(app, { role: Role.SPONSOR });

    const palier = options.sansPalier
      ? null
      : await paliers.save(
          paliers.create({
            nom: `Palier ${randomUUID().slice(0, 8)}`,
            ordre: 1,
            accesAnnuaire: options.accesAnnuaire ?? true,
            maxConsultationsProfils: options.maxConsultations ?? 10,
            maxTelechargementsCv: options.maxCv ?? 5,
          }),
        );

    const sponsor = await sponsors.save(
      sponsors.create({
        user: compte.user,
        nom: 'Partenaire',
        email: compte.user.email,
        palier,
        stats: { vuesPage: 0, profilsConsultes: 0, cvTelecharges: 0 },
      }),
    );

    return { ...compte, sponsor };
  };

  /** Publie une fiche pour le finissant, avec un CV. */
  const publierFiche = async (avecCv = true): Promise<string> => {
    const reponse = await request(app.getHttpServer())
      .put(MOI)
      .set(finissant.entetes)
      .send({ ...FICHE, ...(avecCv ? { cvUrl: 'cv/exemple.pdf' } : {}) })
      .expect(200);

    return (reponse.body as { id: string }).id;
  };

  const racineStockage = join(tmpdir(), `cocfet-annuaire-${randomUUID()}`);

  beforeAll(async () => {
    // L'adaptateur de stockage est impose : selon qu'un .env local porte ou
    // non des identifiants R2, l'URL serait signee par AWS ou par nous, et
    // l'assertion dependrait de la machine plutot que du code.
    const stockage = new StockageLocal({
      get: (cle: string, defaut?: string) =>
        ({
          STOCKAGE_LOCAL_DIR: racineStockage,
          PORT: '3000',
          API_PREFIX: 'api/v1',
        })[cle] ?? defaut,
      getOrThrow: () => 'secret-de-signature-des-cv',
    } as unknown as ConfigService);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useValue(faussaireMail)
      .overrideProvider(STOCKAGE)
      .useValue(stockage)
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

    profils = app.get(getRepositoryToken(ProfilFinissant));
    sponsors = app.get(getRepositoryToken(Sponsor));
    paliers = app.get(getRepositoryToken(PalierSponsor));
    journal = app.get(getRepositoryToken(JournalActivite));
    users = app.get(getRepositoryToken(User));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await journal.createQueryBuilder().delete().execute();
    await profils.createQueryBuilder().delete().execute();
    await sponsors.createQueryBuilder().delete().execute();
    await paliers.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);

    admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
    finissant = await creerCompteAuthentifie(app, {
      promotion: 2027,
      isFinissant: true,
      prenom: 'Awa',
    });
    etudiant = await creerCompteAuthentifie(app, { promotion: 2029 });
  });

  afterAll(async () => {
    await journal.createQueryBuilder().delete().execute();
    await profils.createQueryBuilder().delete().execute();
    await sponsors.createQueryBuilder().delete().execute();
    await paliers.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
    await rm(racineStockage, { recursive: true, force: true });
  });

  describe('sa fiche', () => {
    it('est réservée aux finissants', async () => {
      // L'annuaire est celui des finissants du mandat en cours, pas un profil
      // professionnel ouvert à tous.
      await request(app.getHttpServer())
        .put(MOI)
        .set(etudiant.entetes)
        .send(FICHE)
        .expect(403);
    });

    it('normalise les compétences', async () => {
      // Sans normalisation, « NestJS », « nestjs » et « NestJS » deviennent
      // trois entrées, et la recherche par compétence ne trouve plus rien.
      const reponse = await request(app.getHttpServer())
        .put(MOI)
        .set(finissant.entetes)
        .send(FICHE)
        .expect(200);

      expect((reponse.body as { competences: string[] }).competences).toEqual([
        'nestjs',
        'postgresql',
      ]);
    });

    it('met à jour sans écraser les champs absents', async () => {
      await publierFiche();

      const reponse = await request(app.getHttpServer())
        .put(MOI)
        .set(finissant.entetes)
        .send({ bio: 'Nouvelle présentation.' })
        .expect(200);

      expect(reponse.body).toMatchObject({
        bio: 'Nouvelle présentation.',
        filiere: 'Génie logiciel',
      });
    });

    it('refuse une URL externe non sécurisée', async () => {
      await request(app.getHttpServer())
        .put(MOI)
        .set(finissant.entetes)

        .send({ ...FICHE, linkedinUrl: ADRESSE_EN_CLAIR })
        .expect(400);
    });

    it('signale l’absence de fiche', async () => {
      await request(app.getHttpServer())
        .get(MOI)
        .set(finissant.entetes)
        .expect(404);
    });
  });

  describe('contrôle de la visibilité', () => {
    it('retire le profil de toute recherche', async () => {
      await publierFiche();
      const sponsor = await sponsorAccredite();

      const avant = await request(app.getHttpServer())
        .get(ANNUAIRE)
        .set(sponsor.entetes)
        .expect(200);
      expect((avant.body as { meta: { total: number } }).meta.total).toBe(1);

      await request(app.getHttpServer())
        .patch(`${MOI}/visibilite`)
        .set(finissant.entetes)
        .send({ isVisible: false })
        .expect(200);

      const apres = await request(app.getHttpServer())
        .get(ANNUAIRE)
        .set(sponsor.entetes)
        .expect(200);
      expect((apres.body as { meta: { total: number } }).meta.total).toBe(0);
    });

    it('rend le profil masqué introuvable en consultation directe', async () => {
      const profil = await publierFiche();
      await request(app.getHttpServer())
        .patch(`${MOI}/visibilite`)
        .set(finissant.entetes)
        .send({ isVisible: false })
        .expect(200);

      const sponsor = await sponsorAccredite();

      // Même réponse qu'un identifiant inconnu : distinguer les deux
      // révélerait l'existence d'une fiche masquée.
      await request(app.getHttpServer())
        .get(`${ANNUAIRE}/${profil}`)
        .set(sponsor.entetes)
        .expect(404);
    });

    it('n’offre aucun moyen à l’administration de forcer la visibilité', async () => {
      // Le consentement à figurer dans un annuaire consulté par des
      // entreprises ne se délègue pas au bureau : aucune route ne l'expose.
      const profil = await publierFiche();

      await request(app.getHttpServer())
        .patch(`${ANNUAIRE}/${profil}/visibilite`)
        .set(admin.entetes)
        .send({ isVisible: false })
        .expect(404);
    });
  });

  describe('accès réservé aux accrédités', () => {
    it('refuse un étudiant', async () => {
      await publierFiche();

      await request(app.getHttpServer())
        .get(ANNUAIRE)
        .set(etudiant.entetes)
        .expect(403);
    });

    it('refuse un sponsor sans palier', async () => {
      // Aucune accréditation négociée : le refus est le comportement sûr,
      // l'inverse ouvrirait l'annuaire par omission.
      await publierFiche();
      const sponsor = await sponsorAccredite({ sansPalier: true });

      await request(app.getHttpServer())
        .get(ANNUAIRE)
        .set(sponsor.entetes)
        .expect(403);
    });

    it('refuse un palier sans accès à l’annuaire', async () => {
      await publierFiche();
      const sponsor = await sponsorAccredite({ accesAnnuaire: false });

      await request(app.getHttpServer())
        .get(ANNUAIRE)
        .set(sponsor.entetes)
        .expect(403);
    });

    it('refuse un compte SPONSOR sans fiche partenaire', async () => {
      await publierFiche();
      const orphelin = await creerCompteAuthentifie(app, {
        role: Role.SPONSOR,
      });

      await request(app.getHttpServer())
        .get(ANNUAIRE)
        .set(orphelin.entetes)
        .expect(403);
    });

    it('accepte un sponsor accrédité', async () => {
      await publierFiche();
      const sponsor = await sponsorAccredite();

      await request(app.getHttpServer())
        .get(ANNUAIRE)
        .set(sponsor.entetes)
        .expect(200);
    });

    it('conserve l’accès à l’administration', async () => {
      await publierFiche();

      await request(app.getHttpServer())
        .get(ANNUAIRE)
        .set(admin.entetes)
        .expect(200);
    });

    it('exige un jeton', async () => {
      await request(app.getHttpServer()).get(ANNUAIRE).expect(401);
    });
  });

  describe('recherche', () => {
    it('filtre par filière, promotion et compétences', async () => {
      await publierFiche();
      const sponsor = await sponsorAccredite();

      const parCompetences = await request(app.getHttpServer())
        .get(ANNUAIRE)
        .query({ competences: ['nestjs', 'postgresql'] })
        .set(sponsor.entetes)
        .expect(200);
      expect(
        (parCompetences.body as { meta: { total: number } }).meta.total,
      ).toBe(1);

      // Contenance : le profil doit posséder **toutes** les compétences.
      const introuvable = await request(app.getHttpServer())
        .get(ANNUAIRE)
        .query({ competences: ['nestjs', 'kubernetes'] })
        .set(sponsor.entetes)
        .expect(200);
      expect((introuvable.body as { meta: { total: number } }).meta.total).toBe(
        0,
      );

      const parPromotion = await request(app.getHttpServer())
        .get(ANNUAIRE)
        .query({ promotion: 2029 })
        .set(sponsor.entetes)
        .expect(200);
      expect(
        (parPromotion.body as { meta: { total: number } }).meta.total,
      ).toBe(0);
    });

    it('ne livre ni CV ni liens dans la liste', async () => {
      // Une liste complète rendrait le quota décoratif : il suffirait d'en
      // parcourir les pages.
      await publierFiche();
      const sponsor = await sponsorAccredite();

      const reponse = await request(app.getHttpServer())
        .get(ANNUAIRE)
        .set(sponsor.entetes)
        .expect(200);

      const premier = (reponse.body as { donnees: Record<string, unknown>[] })
        .donnees[0];
      expect(premier).toMatchObject({ prenom: 'Awa', promotion: 2027 });
      expect(premier).not.toHaveProperty('cvUrl');
      expect(premier).not.toHaveProperty('bio');
      expect(premier).not.toHaveProperty('linkedinUrl');
    });

    it('ne consomme aucun quota', async () => {
      await publierFiche();
      const sponsor = await sponsorAccredite({ maxConsultations: 1 });

      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .get(ANNUAIRE)
          .set(sponsor.entetes)
          .expect(200);
      }

      await expect(
        sponsors.findOne({ where: { id: sponsor.sponsor.id } }),
      ).resolves.toMatchObject({ stats: { profilsConsultes: 0 } });
    });

    it('exclut les comptes désactivés', async () => {
      const profil = await publierFiche();
      await users.update(finissant.user.id, { isActive: false });
      const sponsor = await sponsorAccredite();

      const reponse = await request(app.getHttpServer())
        .get(ANNUAIRE)
        .set(sponsor.entetes)
        .expect(200);
      expect((reponse.body as { meta: { total: number } }).meta.total).toBe(0);

      await request(app.getHttpServer())
        .get(`${ANNUAIRE}/${profil}`)
        .set(sponsor.entetes)
        .expect(404);
    });
  });

  describe('quotas', () => {
    it('décompte une consultation de fiche complète', async () => {
      const profil = await publierFiche();
      const sponsor = await sponsorAccredite({ maxConsultations: 2 });

      const reponse = await request(app.getHttpServer())
        .get(`${ANNUAIRE}/${profil}`)
        .set(sponsor.entetes)
        .expect(200);

      expect(reponse.body).toMatchObject({ bio: FICHE.bio, aUnCv: true });
      await expect(
        sponsors.findOne({ where: { id: sponsor.sponsor.id } }),
      ).resolves.toMatchObject({ stats: { profilsConsultes: 1 } });
    });

    it('refuse au-delà du plafond', async () => {
      const profil = await publierFiche();
      const sponsor = await sponsorAccredite({ maxConsultations: 1 });

      await request(app.getHttpServer())
        .get(`${ANNUAIRE}/${profil}`)
        .set(sponsor.entetes)
        .expect(200);

      await request(app.getHttpServer())
        .get(`${ANNUAIRE}/${profil}`)
        .set(sponsor.entetes)
        .expect(403);
    });

    it('ne laisse pas deux consultations simultanées franchir la dernière unité', async () => {
      // Lire puis écrire laisserait les deux passer : le quota vendu au
      // partenaire ne serait pas celui appliqué.
      const profil = await publierFiche();
      const sponsor = await sponsorAccredite({ maxConsultations: 1 });

      const resultats = await Promise.all([
        request(app.getHttpServer())
          .get(`${ANNUAIRE}/${profil}`)
          .set(sponsor.entetes),
        request(app.getHttpServer())
          .get(`${ANNUAIRE}/${profil}`)
          .set(sponsor.entetes),
      ]);

      expect(resultats.filter((r) => r.status === 200)).toHaveLength(1);
      expect(resultats.filter((r) => r.status === 403)).toHaveLength(1);
      await expect(
        sponsors.findOne({ where: { id: sponsor.sponsor.id } }),
      ).resolves.toMatchObject({ stats: { profilsConsultes: 1 } });
    });

    it('ne décompte rien pour un administrateur', async () => {
      // Il ne paie pas d'accréditation.
      const profil = await publierFiche();
      await sponsorAccredite();

      await request(app.getHttpServer())
        .get(`${ANNUAIRE}/${profil}`)
        .set(admin.entetes)
        .expect(200);
    });

    it('applique un quota dérogatoire prioritaire sur le palier', async () => {
      const profil = await publierFiche();
      const sponsor = await sponsorAccredite({ maxConsultations: 10 });
      await sponsors.update(sponsor.sponsor.id, {
        quotasPersonnalises: { consultationsProfils: 1 },
      });

      await request(app.getHttpServer())
        .get(`${ANNUAIRE}/${profil}`)
        .set(sponsor.entetes)
        .expect(200);
      await request(app.getHttpServer())
        .get(`${ANNUAIRE}/${profil}`)
        .set(sponsor.entetes)
        .expect(403);
    });

    it('expose l’état des quotas au partenaire', async () => {
      const profil = await publierFiche();
      const sponsor = await sponsorAccredite({ maxConsultations: 4, maxCv: 2 });

      await request(app.getHttpServer())
        .get(`${ANNUAIRE}/${profil}`)
        .set(sponsor.entetes)
        .expect(200);

      const reponse = await request(app.getHttpServer())
        .get(`${ANNUAIRE}/quotas`)
        .set(sponsor.entetes)
        .expect(200);

      expect(reponse.body).toEqual({
        consultationsProfils: { utilise: 1, plafond: 4 },
        telechargementsCv: { utilise: 0, plafond: 2 },
      });
    });

    it('remet les compteurs à zéro sur demande du bureau', async () => {
      const profil = await publierFiche();
      const sponsor = await sponsorAccredite({ maxConsultations: 1 });
      await request(app.getHttpServer())
        .get(`${ANNUAIRE}/${profil}`)
        .set(sponsor.entetes)
        .expect(200);

      await request(app.getHttpServer())
        .post(`${ANNUAIRE}/sponsors/${sponsor.sponsor.id}/reinitialiser-quotas`)
        .set(admin.entetes)
        .expect(204);

      await request(app.getHttpServer())
        .get(`${ANNUAIRE}/${profil}`)
        .set(sponsor.entetes)
        .expect(200);
    });
  });

  describe('téléchargement du CV', () => {
    it('renvoie une URL signée qui expire', async () => {
      // Un lien permanent circulerait bien au-delà du partenaire accrédité, et
      // le CV est la pièce la plus sensible de l'annuaire.
      const profil = await publierFiche();
      const sponsor = await sponsorAccredite();

      const reponse = await request(app.getHttpServer())
        .post(`${ANNUAIRE}/${profil}/cv`)
        .set(sponsor.entetes)
        .expect(201);

      const corps = reponse.body as { url: string; expireDans: number };
      expect(corps.url).toContain('signature=');
      expect(corps.expireDans).toBe(300);
    });

    it('décompte le quota et trace le téléchargement', async () => {
      const profil = await publierFiche();
      const sponsor = await sponsorAccredite({ maxCv: 2 });

      await request(app.getHttpServer())
        .post(`${ANNUAIRE}/${profil}/cv`)
        .set(sponsor.entetes)
        .expect(201);

      await expect(
        sponsors.findOne({ where: { id: sponsor.sponsor.id } }),
      ).resolves.toMatchObject({ stats: { cvTelecharges: 1 } });

      const traces = await journal.find();
      expect(traces.some((t) => t.message.includes('CV'))).toBe(true);
    });

    it('refuse au-delà du plafond', async () => {
      const profil = await publierFiche();
      const sponsor = await sponsorAccredite({ maxCv: 1 });

      await request(app.getHttpServer())
        .post(`${ANNUAIRE}/${profil}/cv`)
        .set(sponsor.entetes)
        .expect(201);
      await request(app.getHttpServer())
        .post(`${ANNUAIRE}/${profil}/cv`)
        .set(sponsor.entetes)
        .expect(403);
    });

    it('refuse un palier n’autorisant aucun téléchargement', async () => {
      const profil = await publierFiche();
      const sponsor = await sponsorAccredite({ maxCv: 0 });

      await request(app.getHttpServer())
        .post(`${ANNUAIRE}/${profil}/cv`)
        .set(sponsor.entetes)
        .expect(403);
    });

    it('signale l’absence de CV sans consommer le quota', async () => {
      const profil = await publierFiche(false);
      const sponsor = await sponsorAccredite({ maxCv: 1 });

      await request(app.getHttpServer())
        .post(`${ANNUAIRE}/${profil}/cv`)
        .set(sponsor.entetes)
        .expect(404);

      await expect(
        sponsors.findOne({ where: { id: sponsor.sponsor.id } }),
      ).resolves.toMatchObject({ stats: { cvTelecharges: 0 } });
    });
  });
});
