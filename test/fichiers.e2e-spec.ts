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
});
