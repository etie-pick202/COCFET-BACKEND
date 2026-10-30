import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { Article } from './../src/modules/article/entities/article.entity';
import { MailService } from './../src/modules/mail/mail.service';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const ARTICLES = '/api/v1/articles';
const FICHIERS = '/api/v1/fichiers';

/** « ftyp » à l'octet 4 : la signature d'un MP4. */
const MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]),
  Buffer.from('isom'),
  Buffer.alloc(2048, 1),
]);

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 2),
]);

/**
 * Les actualités enrichies, de bout en bout : vidéo de couverture, médias,
 * commentaires, consultations, aperçu de partage.
 */
describe('Actualités (e2e)', () => {
  let app: INestApplication<App>;
  let articles: Repository<Article>;
  let admin: CompteDeTest;
  let lecteur: CompteDeTest;

  const faussaireMail = {
    envoyerNotification: jest.fn().mockResolvedValue(undefined),
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    envoyerVerificationEmail: jest.fn().mockResolvedValue(undefined),
    envoyerTentativeInscription: jest.fn().mockResolvedValue(undefined),
    envoyerInvitationSponsor: jest.fn().mockResolvedValue(undefined),
    envoyerBienvenueAuBureau: jest.fn().mockResolvedValue(undefined),
  };

  const redigerEtPublier = async (
    corps: Record<string, unknown> = {},
  ): Promise<{ id: string; slug: string }> => {
    const creation = await request(app.getHttpServer())
      .post(ARTICLES)
      .set(admin.entetes)
      .send({
        titre: 'Compte rendu du gala',
        contenu: 'Un long compte rendu de la soirée.',
        ...corps,
      })
      .expect(201);
    const { id, slug } = creation.body as { id: string; slug: string };

    await request(app.getHttpServer())
      .post(`${ARTICLES}/${id}/publier`)
      .set(admin.entetes)
      .send({})
      .expect(201);

    return { id, slug };
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

    articles = app.get(getRepositoryToken(Article));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await articles.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    admin = await creerCompteAuthentifie(app, {
      role: Role.ADMIN,
      promotion: null,
    });
    lecteur = await creerCompteAuthentifie(app, { promotion: 2027 });
  });

  afterAll(async () => {
    await articles.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('vidéo de couverture', () => {
    const envoyerVideo = (compte: CompteDeTest, contenu: Buffer) =>
      request(app.getHttpServer())
        .post(`${FICHIERS}/video`)
        .set(compte.entetes)
        .attach('fichier', contenu, 'recap.mp4');

    it('range la vidéo dans « videos/ » et la couverture la référence', async () => {
      const envoi = await envoyerVideo(admin, MP4).expect(201);
      const { cle, type } = envoi.body as { cle: string; type: string };
      expect(cle).toMatch(/^videos\/.+\.mp4$/);
      expect(type).toBe('video/mp4');

      const { slug } = await redigerEtPublier({ couvertureVideo: cle });

      const lu = await request(app.getHttpServer())
        .get(`${ARTICLES}/slug/${slug}`)
        .expect(200);
      expect((lu.body as { couvertureVideo: string }).couvertureVideo).toBe(
        cle,
      );
    });

    it('refuse un fichier qui n’est pas une vidéo', async () => {
      await envoyerVideo(admin, PNG).expect(400);
    });

    it('réserve l’envoi de vidéos au bureau', async () => {
      await envoyerVideo(lecteur, MP4).expect(403);
    });

    it('refuse une vidéo envoyée par la route des images', async () => {
      await request(app.getHttpServer())
        .post(FICHIERS)
        .set(admin.entetes)
        .field('usage', 'article-video')
        .attach('fichier', MP4, 'recap.mp4')
        .expect(400);
    });

    it('refuse une clé de couverture hors du dossier des vidéos', async () => {
      await request(app.getHttpServer())
        .post(ARTICLES)
        .set(admin.entetes)
        .send({
          titre: 'Un titre',
          contenu: 'Un contenu assez long.',
          couvertureVideo: 'cv/secret.pdf',
        })
        .expect(400);
    });

    it('se lit par morceaux, comme l’exigent Safari et les mobiles', async () => {
      const envoi = await envoyerVideo(admin, MP4).expect(201);
      const { url } = envoi.body as { url: string };
      const chemin = new URL(url);

      const partiel = await request(app.getHttpServer())
        .get(
          `${chemin.pathname}${chemin.search}`.replace(
            '/api/v1/api/v1',
            '/api/v1',
          ),
        )
        .set('Range', 'bytes=0-9');

      // Le stockage local sert la plage ; un stockage distant (R2) la sert lui-même.
      if (partiel.status !== 404) {
        expect(partiel.status).toBe(206);
        expect(partiel.headers['content-range']).toMatch(/^bytes 0-9\//);
        expect(partiel.headers['content-type']).toContain('video/mp4');
      }
    });
  });

  describe('médias de pages publiques', () => {
    it('délivre sans connexion l’adresse d’un média d’actualité', async () => {
      await request(app.getHttpServer())
        .get(`${FICHIERS}/url-signee`)
        .query({ cle: 'videos/recap.mp4' })
        .expect(200);
      await request(app.getHttpServer())
        .get(`${FICHIERS}/url-signee`)
        .query({ cle: 'articles/photo.png' })
        .expect(200);
    });

    it('garde les justificatifs, CV et photos de profil derrière une connexion', async () => {
      for (const cle of [
        'justificatifs/preuve.png',
        'cv/cv.pdf',
        'avatars/moi.png',
      ]) {
        await request(app.getHttpServer())
          .get(`${FICHIERS}/url-signee`)
          .query({ cle })
          .expect(404);
      }
    });

    it('délivre les photos de profil à un compte connecté', async () => {
      await request(app.getHttpServer())
        .get(`${FICHIERS}/url-signee`)
        .query({ cle: 'avatars/moi.png' })
        .set(lecteur.entetes)
        .expect(200);
    });

    it('ne délivre pas pour autant le CV ou le justificatif d’un autre', async () => {
      for (const cle of ['justificatifs/preuve.png', 'cv/cv.pdf']) {
        await request(app.getHttpServer())
          .get(`${FICHIERS}/url-signee`)
          .query({ cle })
          .set(lecteur.entetes)
          .expect(404);
      }
    });
  });

  describe('catégories', () => {
    it('ne garde qu’une catégorie, quelle que soit la casse saisie', async () => {
      await redigerEtPublier({ titre: 'Premier', categorie: 'vie du campus' });
      await redigerEtPublier({ titre: 'Second', categorie: 'VIE DU  CAMPUS' });

      const reponse = await request(app.getHttpServer())
        .get(`${ARTICLES}/categories`)
        .expect(200);

      expect(reponse.body).toEqual(['Vie du campus']);
    });

    it('filtre sans égard à la casse', async () => {
      await redigerEtPublier({ categorie: 'Sport' });

      const reponse = await request(app.getHttpServer())
        .get(ARTICLES)
        .query({ categorie: 'sport' })
        .expect(200);

      expect((reponse.body as { meta: { total: number } }).meta.total).toBe(1);
    });
  });

  describe('lecteurs', () => {
    it('n’expose de l’auteur que son nom et sa photo', async () => {
      const { slug } = await redigerEtPublier();

      const reponse = await request(app.getHttpServer())
        .get(`${ARTICLES}/slug/${slug}`)
        .expect(200);

      const { auteur } = reponse.body as { auteur: Record<string, unknown> };
      expect(Object.keys(auteur).sort((a, b) => a.localeCompare(b))).toEqual([
        'avatar',
        'id',
        'nom',
        'prenom',
      ]);
    });

    it('compte les consultations d’un article paru', async () => {
      const { id, slug } = await redigerEtPublier();

      await request(app.getHttpServer())
        .post(`${ARTICLES}/${id}/vue`)
        .expect(204);
      await request(app.getHttpServer())
        .post(`${ARTICLES}/${id}/vue`)
        .expect(204);

      const lu = await request(app.getHttpServer())
        .get(`${ARTICLES}/slug/${slug}`)
        .expect(200);
      expect((lu.body as { vues: number }).vues).toBe(2);
    });

    it('ne compte pas un brouillon', async () => {
      const creation = await request(app.getHttpServer())
        .post(ARTICLES)
        .set(admin.entetes)
        .send({ titre: 'Un brouillon', contenu: 'Un contenu assez long.' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`${ARTICLES}/${(creation.body as { id: string }).id}/vue`)
        .expect(404);
    });

    it('redirige l’aperçu de partage vers l’image de couverture', async () => {
      const { slug } = await redigerEtPublier({
        imageCouverture: 'articles/couverture.png',
      });

      const reponse = await request(app.getHttpServer())
        .get(`${ARTICLES}/slug/${slug}/couverture`)
        .redirects(0);

      expect(reponse.status).toBe(302);
      expect(reponse.headers.location).toContain('articles');
    });

    it('répond 404 à l’aperçu d’un article sans image', async () => {
      const { slug } = await redigerEtPublier();

      await request(app.getHttpServer())
        .get(`${ARTICLES}/slug/${slug}/couverture`)
        .expect(404);
    });
  });

  describe('commentaires', () => {
    const commenter = (id: string, compte: CompteDeTest, contenu: string) =>
      request(app.getHttpServer())
        .post(`${ARTICLES}/${id}/commentaires`)
        .set(compte.entetes)
        .send({ contenu });

    it('réserve le commentaire aux comptes connectés', async () => {
      const { id } = await redigerEtPublier();

      await request(app.getHttpServer())
        .post(`${ARTICLES}/${id}/commentaires`)
        .send({ contenu: 'Bravo' })
        .expect(401);
    });

    it('publie, puis liste sans connexion', async () => {
      const { id } = await redigerEtPublier();

      await commenter(id, lecteur, 'Bravo à toute l’équipe').expect(201);

      const liste = await request(app.getHttpServer())
        .get(`${ARTICLES}/${id}/commentaires`)
        .expect(200);
      const { donnees } = liste.body as {
        donnees: { contenu: string; auteur: Record<string, unknown> }[];
      };
      expect(donnees).toHaveLength(1);
      expect(donnees[0].contenu).toBe('Bravo à toute l’équipe');
      expect(Object.keys(donnees[0].auteur)).not.toContain('email');
    });

    it('refuse de commenter deux fois en quelques secondes', async () => {
      const { id } = await redigerEtPublier();

      await commenter(id, lecteur, 'Premier').expect(201);
      await commenter(id, lecteur, 'Second').expect(429);
    });

    it('refuse un commentaire vide ou trop long', async () => {
      const { id } = await redigerEtPublier();

      await commenter(id, lecteur, '   ').expect(400);
      await commenter(id, lecteur, 'x'.repeat(1001)).expect(400);
    });

    it('respecte la fermeture des commentaires', async () => {
      const { id } = await redigerEtPublier({ commentairesActifs: false });

      await commenter(id, lecteur, 'Bravo').expect(409);
    });

    it('masque un commentaire pour le public, pas pour l’administration', async () => {
      const { id } = await redigerEtPublier();
      const cree = await commenter(id, lecteur, 'À modérer').expect(201);
      const commentaireId = (cree.body as { id: string }).id;

      await request(app.getHttpServer())
        .post(`${ARTICLES}/commentaires/${commentaireId}/masquer`)
        .set(admin.entetes)
        .send({ masque: true })
        .expect(201);

      const public_ = await request(app.getHttpServer())
        .get(`${ARTICLES}/${id}/commentaires`)
        .expect(200);
      expect((public_.body as { donnees: unknown[] }).donnees).toHaveLength(0);

      const moderation = await request(app.getHttpServer())
        .get(`${ARTICLES}/${id}/commentaires`)
        .set(admin.entetes)
        .expect(200);
      expect((moderation.body as { donnees: unknown[] }).donnees).toHaveLength(
        1,
      );
    });

    it('réserve la modération à l’administration', async () => {
      const { id } = await redigerEtPublier();
      const cree = await commenter(id, lecteur, 'Bravo').expect(201);

      await request(app.getHttpServer())
        .post(
          `${ARTICLES}/commentaires/${(cree.body as { id: string }).id}/masquer`,
        )
        .set(lecteur.entetes)
        .send({})
        .expect(403);
    });

    it('laisse l’auteur supprimer le sien, et personne d’autre', async () => {
      const { id } = await redigerEtPublier();
      const autre = await creerCompteAuthentifie(app, { promotion: 2027 });
      const cree = await commenter(id, lecteur, 'Le mien').expect(201);
      const commentaireId = (cree.body as { id: string }).id;

      await request(app.getHttpServer())
        .delete(`${ARTICLES}/commentaires/${commentaireId}`)
        .set(autre.entetes)
        .expect(403);
      await request(app.getHttpServer())
        .delete(`${ARTICLES}/commentaires/${commentaireId}`)
        .set(lecteur.entetes)
        .expect(204);
    });

    it('cache les commentaires d’un brouillon', async () => {
      const creation = await request(app.getHttpServer())
        .post(ARTICLES)
        .set(admin.entetes)
        .send({ titre: 'Un brouillon', contenu: 'Un contenu assez long.' })
        .expect(201);

      await request(app.getHttpServer())
        .get(`${ARTICLES}/${(creation.body as { id: string }).id}/commentaires`)
        .expect(404);
    });
  });

  describe('annonce ciblée', () => {
    it('exige la promotion pour une annonce par promotion', async () => {
      await request(app.getHttpServer())
        .post(ARTICLES)
        .set(admin.entetes)
        .send({
          titre: 'Un titre',
          contenu: 'Un contenu assez long.',
          audience: 'PROMOTION',
        })
        .expect(400);
    });

    it('refuse une audience inconnue', async () => {
      await request(app.getHttpServer())
        .post(ARTICLES)
        .set(admin.entetes)
        .send({
          titre: 'Un titre',
          contenu: 'Un contenu assez long.',
          audience: 'TOUT_LE_MONDE',
        })
        .expect(400);
    });
  });
});
