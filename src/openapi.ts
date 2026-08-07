import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { AppModule } from './app.module';
import { documentSwagger } from './swagger';

/**
 * Écrit la spécification OpenAPI dans `openapi.json`, sans démarrer de serveur.
 *
 * C'est ce fichier que le frontend consomme pour générer un client typé. Le
 * produire en ligne de commande — plutôt que d'obliger à lancer l'API et à
 * ouvrir `/docs` — permet de le régénérer en CI et de voir, en revue, ce qu'un
 * changement de contrat modifie réellement.
 */
async function generer(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix(process.env.API_PREFIX ?? 'api/v1');

  const document = documentSwagger(app);
  writeFileSync('openapi.json', JSON.stringify(document, null, 2));

  const chemins = Object.keys(document.paths).length;
  const schemas = Object.keys(document.components?.schemas ?? {}).length;
  console.log(`openapi.json ecrit : ${chemins} chemins, ${schemas} schemas.`);

  await app.close();
}

void generer();
