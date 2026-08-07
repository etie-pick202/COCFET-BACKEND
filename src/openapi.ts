import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { AppModule } from './app.module';
import { documentSwagger } from './swagger';

const logger = new Logger('OpenAPI');

/**
 * Écrit la spécification OpenAPI dans `openapi.json`, sans démarrer de serveur.
 *
 * C'est ce fichier que le frontend consomme pour générer un client typé. Le
 * produire en ligne de commande — plutôt que d'obliger à lancer l'API et à
 * ouvrir `/docs` — permet de le régénérer en CI et de voir, en revue, ce qu'un
 * changement de contrat modifie réellement.
 */
async function generer(): Promise<void> {
  // Seules les erreurs pendant l'amorçage : les messages de démarrage de Nest
  // n'apprennent rien ici, alors qu'un module qui refuse de se charger doit se
  // voir.
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.setGlobalPrefix(process.env.API_PREFIX ?? 'api/v1');

  const document = documentSwagger(app);
  writeFileSync('openapi.json', JSON.stringify(document, null, 2));

  const chemins = Object.keys(document.paths).length;
  const schemas = Object.keys(document.components?.schemas ?? {}).length;
  // Le bilan doit paraître malgré le silence imposé à l'amorçage : c'est la
  // seule sortie de la commande.
  Logger.overrideLogger(['error', 'log']);
  logger.log(`openapi.json ecrit : ${chemins} chemins, ${schemas} schemas.`);

  await app.close();
}

void generer();
