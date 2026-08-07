import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { monterSwagger } from './swagger';
import { FiltreExceptionGlobal } from './common/erreurs/filtre-exception-global';

async function bootstrap() {
  // rawBody : la signature d'un webhook porte sur les octets exacts recus.
  // Un corps deserialise puis reserialise reordonne les cles et change les
  // espaces — la signature ne correspond alors plus, et toutes les
  // notifications de paiement seraient rejetees.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  app.use(helmet());
  app.setGlobalPrefix(config.get<string>('API_PREFIX', 'api/v1'));
  app.enableCors({
    origin: config
      .get<string>('CORS_ORIGIN', 'http://localhost:5173')
      .split(','),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new FiltreExceptionGlobal());

  // Swagger décrit toute la surface de l'API : chemins, formes de charge
  // utile, rôles attendus. C'est une carte offerte à qui cherche une faille,
  // et elle n'a aucun usage pour un utilisateur final. Elle reste donc fermée
  // en production, sauf activation délibérée.
  const documentationActive =
    config.get<string>('NODE_ENV') !== 'production' ||
    config.get<string>('SWAGGER_ENABLED') === 'true';

  if (documentationActive) {
    monterSwagger(app);
  }

  // Sans cela, un SIGTERM — ce que tout hébergeur envoie au redéploiement —
  // coupe les requêtes en cours et laisse les connexions à la base ouvertes.
  app.enableShutdownHooks();

  // 0.0.0.0 explicitement : dans un conteneur, une écoute sur la seule
  // interface locale est injoignable depuis l'extérieur, et l'hébergeur
  // conclut à un démarrage raté.
  await app.listen(config.get<number>('PORT', 3000), '0.0.0.0');
}

void bootstrap();
