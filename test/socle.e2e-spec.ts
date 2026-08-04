import {
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from './../src/app.module';
import { FiltreExceptionGlobal } from './../src/common/erreurs/filtre-exception-global';
import { Role } from './../src/common/enums/role.enum';
import { Public } from './../src/modules/auth/decorators/public.decorator';
import { Roles } from './../src/modules/auth/decorators/roles.decorator';
import { User } from './../src/modules/user/entities/user.entity';
import {
  CompteDeTest,
  creerCompteAuthentifie,
  jetonExpire,
  jetonSigneAilleurs,
  purgerUtilisateurs,
  signerAcces,
} from './utils/authentification';

/**
 * Contrôleur monté uniquement pour ce test.
 *
 * Aucun module métier n'expose encore de route protégée : sans lui, les gardes
 * globales ne seraient vérifiées par rien. Le jour où ces routes existeront,
 * elles hériteront exactement de ce comportement.
 */
@Controller('socle-test')
class SocleTestController {
  @Public()
  @Get('ouvert')
  ouvert() {
    return { ok: true };
  }

  @Get('protege')
  protege() {
    return { ok: true };
  }

  @Roles(Role.ADMIN)
  @Get('admin')
  admin() {
    return { ok: true };
  }
}

describe('Socle : gardes et jetons (e2e)', () => {
  let app: INestApplication<App>;
  let users: Repository<User>;
  let etudiant: CompteDeTest;
  let admin: CompteDeTest;

  const url = (chemin: string) => `/api/v1/socle-test/${chemin}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [SocleTestController],
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

    users = app.get<Repository<User>>(getRepositoryToken(User));
    await purgerUtilisateurs(app);

    etudiant = await creerCompteAuthentifie(app, { role: Role.STUDENT });
    admin = await creerCompteAuthentifie(app, { role: Role.ADMIN });
  });

  afterAll(async () => {
    await purgerUtilisateurs(app);
    await app.close();
  });

  describe('authentification', () => {
    it('laisse passer une route marquée @Public sans jeton', async () => {
      await request(app.getHttpServer()).get(url('ouvert')).expect(200);
    });

    it('refuse une route protégée sans jeton', async () => {
      await request(app.getHttpServer()).get(url('protege')).expect(401);
    });

    it('accepte un jeton émis par la fixture', async () => {
      // Le point central : ce jeton est signé par le JwtService de
      // l'application et validé par la vraie stratégie, laquelle relit
      // l'utilisateur en base.
      await request(app.getHttpServer())
        .get(url('protege'))
        .set(etudiant.entetes)
        .expect(200);
    });

    it('refuse un jeton expiré, malgré une signature valide', async () => {
      await request(app.getHttpServer())
        .get(url('protege'))
        .set('Authorization', `Bearer ${jetonExpire(app, etudiant.user)}`)
        .expect(401);
    });

    it('refuse un jeton signé avec un autre secret', async () => {
      await request(app.getHttpServer())
        .get(url('protege'))
        .set('Authorization', `Bearer ${jetonSigneAilleurs(etudiant.user)}`)
        .expect(401);
    });

    it('refuse un jeton dont le porteur a été désactivé entre-temps', async () => {
      // Le jeton reste cryptographiquement valide jusqu'à son échéance : c'est
      // la relecture en base qui coupe l'accès immédiatement.
      const compte = await creerCompteAuthentifie(app);
      await users.update(compte.user.id, { isActive: false });

      await request(app.getHttpServer())
        .get(url('protege'))
        .set(compte.entetes)
        .expect(401);
    });

    it('refuse un jeton dont le porteur a été supprimé', async () => {
      const compte = await creerCompteAuthentifie(app);
      const jeton = signerAcces(app, compte.user);
      await users.delete(compte.user.id);

      await request(app.getHttpServer())
        .get(url('protege'))
        .set('Authorization', `Bearer ${jeton}`)
        .expect(401);
    });
  });

  describe('autorisation par rôle', () => {
    it('ouvre la route admin à un administrateur', async () => {
      await request(app.getHttpServer())
        .get(url('admin'))
        .set(admin.entetes)
        .expect(200);
    });

    it('renvoie 403 — et non 401 — à un étudiant authentifié', async () => {
      // La distinction compte côté client : 401 invite à se reconnecter, 403
      // dit que le compte est bon mais les droits insuffisants.
      const reponse = await request(app.getHttpServer())
        .get(url('admin'))
        .set(etudiant.entetes)
        .expect(403);

      // Le corps suit le format unifié du filtre d'exception global.
      expect(reponse.body as Record<string, unknown>).toMatchObject({
        code: expect.any(String) as unknown,
      });
    });

    it('exige quand même un jeton sur une route à rôle', async () => {
      await request(app.getHttpServer()).get(url('admin')).expect(401);
    });

    it('ignore un rôle revendiqué dans le jeton mais absent en base', async () => {
      // Un jeton forgé avec role: ADMIN ne suffit pas : la stratégie recharge
      // le rôle réel depuis la base et écrase celui de la charge utile.
      const jeton = signerAcces(app, { ...etudiant.user, role: Role.ADMIN });

      await request(app.getHttpServer())
        .get(url('admin'))
        .set('Authorization', `Bearer ${jeton}`)
        .expect(403);
    });
  });
});
