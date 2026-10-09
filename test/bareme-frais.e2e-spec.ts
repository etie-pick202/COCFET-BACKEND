import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';

/**
 * Le barème des frais est public : le catalogue l'interroge avant toute
 * connexion. Ce test existe parce qu'une première version, placée sous
 * « /paiements/… », était captée par « GET /paiements/:reference » et
 * répondait 401 — ce que ni un test unitaire ni le typage ne montrent.
 */
describe('Barème des frais (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
    );
    app.useGlobalFilters(new FiltreExceptionGlobal());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('se lit sans être connecté', async () => {
    const reponse = await request(app.getHttpServer())
      .get('/api/v1/frais-paiement')
      .expect(200);

    expect(reponse.body).toMatchObject({
      retraitTaux: { MTN_MOMO: expect.any(Number) as number },
      methodeParDefaut: 'MTN_MOMO',
    });
  });

  it('ne se confond pas avec le suivi d’un paiement', async () => {
    // Le suivi, lui, exige une connexion.
    await request(app.getHttpServer())
      .get('/api/v1/paiements/REF-INCONNUE')
      .expect(401);
  });
});
