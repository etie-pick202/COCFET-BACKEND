import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { ReponseErreurDto } from './common/swagger';

/**
 * Construction du document OpenAPI, partagée entre le serveur et le script de
 * génération : les deux doivent décrire exactement la même API, sans quoi le
 * fichier remis au frontend divergerait de ce que l'API renvoie vraiment.
 */
export function documentSwagger(app: INestApplication): OpenAPIObject {
  const configuration = new DocumentBuilder()
    .setTitle('COCFET API')
    .setDescription(
      [
        "API de la plateforme du Bureau des Finissants de l'UCAC-ICAM.",
        '',
        '### Authentification',
        '',
        'Toute route exige un jeton, sauf mention contraire. Le jeton se',
        "présente en en-tête `Authorization: Bearer <accessToken>`, et s'obtient",
        'par `POST /auth/connexion`.',
        '',
        "L'accès est de courte durée : quand il expire, `POST /auth/rafraichir`",
        'en délivre un nouveau. **Chaque rafraîchissement invalide le',
        'précédent** — rejouer un ancien refresh token coupe toutes les',
        'sessions, le vol étant l’explication la plus probable.',
        '',
        '### Erreurs',
        '',
        'Toutes les erreurs partagent la même forme, décrite par le schéma',
        '`ReponseErreurDto`. Le champ `code` est stable et destiné au code',
        'appelant ; `message` est destiné à l’affichage. Sur un 400, `champs`',
        'détaille les erreurs de validation par champ.',
        '',
        '### Listes',
        '',
        'Les listes acceptent `page`, `limite` (plafonnée à 100), `tri` et',
        '`ordre`, et répondent `{ donnees, meta }`.',
        '',
        '### Fichiers',
        '',
        "Les fichiers ne sont jamais servis par une URL permanente. L'API",
        'renvoie des **clés de stockage** ; une URL signée expirante s’obtient',
        'par `GET /fichiers/url-signee`. Ne stockez jamais une URL signée : elle',
        'serait périmée à la relecture.',
      ].join('\n'),
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .build();

  return SwaggerModule.createDocument(app, configuration, {
    extraModels: [ReponseErreurDto],
  });
}

/** Monte l'interface Swagger sur `/docs`. */
export function monterSwagger(app: INestApplication): void {
  SwaggerModule.setup('docs', app, documentSwagger(app), {
    swaggerOptions: { persistAuthorization: true },
  });
}
