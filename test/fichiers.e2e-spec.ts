import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { StockageLocal } from './../src/modules/file/adaptateurs/stockage-local';
import { STOCKAGE } from './../src/modules/file/ports/stockage';
import { Role } from './../src/common/enums/role.enum';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

/**
 * Accès aux fichiers en stockage local, de bout en bout.
 *
 * Ce parcours vaut d'être testé pour lui-même : l'URL signée est la seule
 * chose qui protège un fichier, aucun jeton d'authentification n'intervient.
 * Une signature mal vérifiée rendrait publics tous les objets de la
 * plateforme, photos de finissants comprises.
 */
describe('Fichiers en stockage local (e2e)', () => {
  let app: INestApplication<App>;
  let stockage: StockageLocal;

  const racine = join(tmpdir(), `cocfet-fichiers-${randomUUID()}`);

  const configStockage = {
    get: (cle: string, defaut?: string) =>
      ({
        STOCKAGE_LOCAL_DIR: racine,
        PORT: '3000',
        API_PREFIX: 'api/v1',
      })[cle] ?? defaut,
    getOrThrow: () => 'secret-de-signature-des-fichiers',
  } as unknown as ConfigService;

  /** L'URL signée est absolue : supertest attend un chemin. */
  const chemin = (url: string) => new URL(url).pathname + new URL(url).search;

  const televerser = () =>
    stockage.televerser(
      {
        originalname: 'affiche.png',
        mimetype: 'image/png',
        buffer: Buffer.from('contenu-binaire'),
      },
      'evenements',
    );

  beforeAll(async () => {
    // L'adaptateur est imposé plutôt que déduit de l'environnement : selon
    // qu'un `.env` local porte ou non des identifiants R2, le module choisirait
    // l'un ou l'autre, et ces tests passeraient ou non sans que rien du code
    // n'ait changé. Le contrôleur et l'adaptateur restent les vrais.
    stockage = new StockageLocal(configStockage);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
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
  });

  afterAll(async () => {
    await app.close();
    await rm(racine, { recursive: true, force: true });
  });

  it('sert le fichier à qui présente une URL signée valide, sans authentification', async () => {
    const cle = await televerser();

    const reponse = await request(app.getHttpServer())
      .get(chemin(await stockage.urlSignee(cle)))
      .expect(200);

    expect(reponse.body as Buffer).toEqual(Buffer.from('contenu-binaire'));
    expect(reponse.headers['content-type']).toContain('image/png');
  });

  it('interdit au navigateur de deviner le type', async () => {
    // Sans nosniff, un fichier au contenu HTML servi comme image pourrait être
    // réinterprété et exécuté dans l'origine de l'API.
    const cle = await televerser();

    const reponse = await request(app.getHttpServer())
      .get(chemin(await stockage.urlSignee(cle)))
      .expect(200);

    expect(reponse.headers['x-content-type-options']).toBe('nosniff');
  });

  it('force le téléchargement d’un type non affichable', async () => {
    // Une page HTML téléversée puis affichée en ligne s'exécuterait dans
    // l'origine de l'API, avec accès aux cookies du domaine.
    const cle = await stockage.televerser(
      {
        originalname: 'piege.html',
        mimetype: 'text/html',
        buffer: Buffer.from('<script>alert(1)</script>'),
      },
      'evenements',
    );

    const reponse = await request(app.getHttpServer())
      .get(chemin(await stockage.urlSignee(cle)))
      .expect(200);

    expect(reponse.headers['content-type']).toContain(
      'application/octet-stream',
    );
    expect(reponse.headers['content-disposition']).toContain('attachment');
  });

  it('refuse une signature falsifiée', async () => {
    const cle = await televerser();
    const url = new URL(await stockage.urlSignee(cle));
    url.searchParams.set('signature', 'f'.repeat(64));

    await request(app.getHttpServer())
      .get(url.pathname + url.search)
      .expect(404);
  });

  it('refuse une échéance repoussée sans re-signature', async () => {
    const cle = await televerser();
    const url = new URL(await stockage.urlSignee(cle));
    url.searchParams.set(
      'expire',
      String(Number(url.searchParams.get('expire')) + 86400),
    );

    await request(app.getHttpServer())
      .get(url.pathname + url.search)
      .expect(404);
  });

  it('refuse un lien périmé', async () => {
    const cle = await televerser();

    await request(app.getHttpServer())
      .get(chemin(await stockage.urlSignee(cle, -60)))
      .expect(404);
  });

  it('refuse une clé remontant hors du dossier de stockage', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/fichiers')
      .query({
        cle: 'evenements/../../../.env',
        expire: String(2 ** 31),
        signature: 'peu-importe',
      })
      .expect(404);
  });

  it('refuse une requête sans paramètres', async () => {
    await request(app.getHttpServer()).get('/api/v1/fichiers').expect(404);
  });

  it('ne sert plus un fichier supprimé', async () => {
    const cle = await televerser();
    const url = chemin(await stockage.urlSignee(cle));
    await stockage.supprimer(cle);

    await request(app.getHttpServer()).get(url).expect(404);
  });
  describe('envoi', () => {
    const ENVOI = '/api/v1/fichiers';
    let compte: CompteDeTest;
    let admin: CompteDeTest;

    /** En-tête PNG réel, suivi d'un remplissage. */
    const png = () => {
      const b = Buffer.alloc(512);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
      return b;
    };

    beforeAll(async () => {
      compte = await creerCompteAuthentifie(app);
      admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
    });

    afterAll(async () => {
      await purgerUtilisateurs(app);
    });

    it('accepte une image et la range selon son usage', async () => {
      const reponse = await request(app.getHttpServer())
        .post(ENVOI)
        .set(compte.entetes)
        .field('usage', 'avatar')
        .attach('fichier', png(), 'photo.png')
        .expect(201);

      const corps = reponse.body as { cle: string; url: string; type: string };
      expect(corps.cle.startsWith('avatars/')).toBe(true);
      expect(corps.type).toBe('image/png');
      expect(corps.url).toContain('signature=');
    });

    it('refuse un exécutable renommé en .png', async () => {
      // Le champ mimetype est fourni par le client : seul le contenu tranche.
      const executable = Buffer.alloc(512);
      Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(executable);

      await request(app.getHttpServer())
        .post(ENVOI)
        .set(compte.entetes)
        .field('usage', 'avatar')
        .attach('fichier', executable, {
          filename: 'photo.png',
          contentType: 'image/png',
        })
        .expect(400);
    });

    it('refuse une image là où un CV est attendu', async () => {
      await request(app.getHttpServer())
        .post(ENVOI)
        .set(compte.entetes)
        .field('usage', 'cv')
        .attach('fichier', png(), 'cv.pdf')
        .expect(400);
    });

    it('refuse un usage inconnu plutôt que de deviner un dossier', async () => {
      await request(app.getHttpServer())
        .post(ENVOI)
        .set(compte.entetes)
        .field('usage', '../public')
        .attach('fichier', png(), 'photo.png')
        .expect(400);
    });

    it('exige un jeton', async () => {
      await request(app.getHttpServer())
        .post(ENVOI)
        .field('usage', 'avatar')
        .attach('fichier', png(), 'photo.png')
        .expect(401);
    });

    it('sert ensuite le fichier envoyé', async () => {
      const envoi = await request(app.getHttpServer())
        .post(ENVOI)
        .set(compte.entetes)
        .field('usage', 'evenement')
        .attach('fichier', png(), 'affiche.png')
        .expect(201);

      const url = new URL((envoi.body as { url: string }).url);
      const lecture = await request(app.getHttpServer())
        .get(url.pathname + url.search)
        .expect(200);

      expect(lecture.headers['content-type']).toContain('image/png');
    });

    it('réserve la suppression au bureau', async () => {
      // La clé seule ne dit pas à quelle entité l'objet est rattaché : rien ne
      // garantirait que le demandeur en est le propriétaire.
      const envoi = await request(app.getHttpServer())
        .post(ENVOI)
        .set(compte.entetes)
        .field('usage', 'avatar')
        .attach('fichier', png(), 'photo.png')
        .expect(201);

      const cle = (envoi.body as { cle: string }).cle;

      await request(app.getHttpServer())
        .delete(ENVOI)
        .query({ cle })
        .set(compte.entetes)
        .expect(403);

      await request(app.getHttpServer())
        .delete(ENVOI)
        .query({ cle })
        .set(admin.entetes)
        .expect(204);
    });
  });
});
