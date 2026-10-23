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
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  purgerUtilisateurs,
} from './utils/authentification';

const ANNEE_ACTIVE = 2027;

/**
 * Passer quelqu'un étudiant doit lui donner sa promotion.
 *
 * Tout ce qui concerne les étudiants — l'annuaire, les cotisations ciblées, le
 * tableau de bord — repose sur la promotion. Changer le seul rôle d'un compte
 * gmail laissait la personne « étudiante » sans rien de ce qui s'y rattache.
 */
describe('Promotion au changement de rôle (e2e)', () => {
  let app: INestApplication<App>;
  let users: Repository<User>;
  let generations: Repository<Generation>;
  let admin: CompteDeTest;
  let externe: CompteDeTest;

  const modifier = (corps: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/api/v1/utilisateurs/${externe.user.id}`)
      .set(admin.entetes)
      .send(corps);

  const relire = () => users.findOneByOrFail({ id: externe.user.id });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await generations.save(
      generations.create({
        annee: ANNEE_ACTIVE,
        nom: `Promotion ${ANNEE_ACTIVE}`,
        isActive: true,
      }),
    );

    admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
    // Adresse gmail : rien n'en laisse déduire une promotion.
    externe = await creerCompteAuthentifie(app, { role: Role.VISITOR });
  });

  afterAll(async () => {
    await generations.createQueryBuilder().delete().execute();
    await purgerUtilisateurs(app);
    await app.close();
  });

  it('refuse de passer étudiant sans promotion quand l’adresse n’en donne pas', async () => {
    await modifier({ role: Role.STUDENT }).expect(400);

    await expect(relire()).resolves.toMatchObject({ role: Role.VISITOR });
  });

  it('enregistre la promotion et marque le finissant de la génération active', async () => {
    await modifier({ role: Role.STUDENT, promotion: ANNEE_ACTIVE }).expect(200);

    await expect(relire()).resolves.toMatchObject({
      role: Role.STUDENT,
      promotion: ANNEE_ACTIVE,
      isFinissant: true,
    });
  });

  it('ne marque pas finissant une autre promotion', async () => {
    await modifier({ role: Role.STUDENT, promotion: 2029 }).expect(200);

    await expect(relire()).resolves.toMatchObject({
      promotion: 2029,
      isFinissant: false,
    });
  });

  it('retire la promotion en repassant visiteur', async () => {
    await modifier({ role: Role.STUDENT, promotion: ANNEE_ACTIVE }).expect(200);

    await modifier({ role: Role.VISITOR }).expect(200);

    await expect(relire()).resolves.toMatchObject({
      role: Role.VISITOR,
      promotion: null,
      isFinissant: false,
    });
  });
});
