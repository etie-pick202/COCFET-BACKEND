import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('COCFET API')
    .setDescription(
      "API de la plateforme du Bureau des Finissants de l'UCAC-ICAM",
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(config.get<number>('PORT', 3000));
}

void bootstrap();
