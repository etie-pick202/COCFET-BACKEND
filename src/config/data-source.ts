import 'dotenv/config';
import { DataSource } from 'typeorm';
import { optionsTls } from './tls.config';

/**
 * Source de données destinée au **CLI TypeORM** (génération et exécution des
 * migrations). Elle est volontairement séparée de la configuration consommée
 * par NestJS : le CLI s'exécute hors du conteneur d'injection et ne peut donc
 * pas résoudre `ConfigService`.
 *
 * Les deux doivent rester cohérentes — c'est pourquoi les options TLS sont
 * factorisées dans `tls.config.ts` plutôt que dupliquées.
 */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  // Chemins en .ts : le CLI est lancé via ts-node.
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/migrations/*.ts'],
  // Jamais de synchronisation automatique ici : le CLI sert précisément à
  // produire les migrations qui la remplacent.
  synchronize: false,
  ssl: optionsTls(),
});
