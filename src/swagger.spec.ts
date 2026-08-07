import { Controller, Get, INestApplication, Module } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { ReponseErreurDto } from './common/swagger';
import { documentSwagger, monterSwagger } from './swagger';

/**
 * Module minimal : la construction du document ne dépend pas de l'application
 * réelle, et la monter exigerait une base de données pour éprouver une
 * fonction qui n'en touche aucune.
 */
@ApiTags('Essai')
@Controller('essai')
class ControleurEssai {
  @Get()
  @ApiOkResponse({ type: ReponseErreurDto })
  lire(): ReponseErreurDto {
    return {} as ReponseErreurDto;
  }
}

@Module({ controllers: [ControleurEssai] })
class ModuleEssai {}

describe('documentSwagger', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [ModuleEssai],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('déclare le schéma de sécurité « bearer »', () => {
    const document = documentSwagger(app);

    // Le nom compte autant que le type : les décorateurs @ApiBearerAuth() des
    // contrôleurs y renvoient, et une divergence laisserait les routes sans
    // bouton d'authentification dans l'interface.
    expect(document.components?.securitySchemes?.bearer).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('émet le schéma des erreurs même si aucune route ne le référence', () => {
    const document = documentSwagger(app);

    // Transmis en « extraModels » : le frontend écrit son gestionnaire
    // d'erreurs à partir du contrat, et non en observant les réponses.
    expect(document.components?.schemas?.ReponseErreurDto).toBeDefined();
  });

  it('décrit les conventions de l’API dans la description', () => {
    const { description } = documentSwagger(app).info;

    expect(description).toContain('POST /auth/rafraichir');
    expect(description).toContain('GET /fichiers/url-signee');
  });

  it('reprend les routes des contrôleurs', () => {
    const document = documentSwagger(app);

    expect(Object.keys(document.paths)).toContain('/essai');
  });

  it('monte l’interface sans exiger de document préconstruit', () => {
    expect(() => monterSwagger(app)).not.toThrow();
  });
});
