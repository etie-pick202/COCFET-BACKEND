import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { optionsTls } from './tls.config';

/**
 * Le schéma est géré **exclusivement par migrations**, y compris en
 * développement : c'est ainsi qu'on garantit qu'une migration fonctionne avant
 * de l'appliquer en production.
 *
 * `synchronize` reste disponible pour du prototypage local via
 * DATABASE_SYNCHRONIZE=true, mais jamais ailleurs qu'en développement — cette
 * option peut supprimer des colonnes, donc des données.
 */
function synchronisationActivee(): boolean {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.DATABASE_SYNCHRONIZE === 'true'
  );
}

export default registerAs('database', (): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  autoLoadEntities: true,
  // Chemins compilés : à l'exécution, l'application tourne depuis dist/.
  migrations: [`${__dirname}/../migrations/*{.ts,.js}`],
  // Les migrations sont jouées au démarrage hors production, où elles sont
  // appliquées explicitement avant le basculement (voir docs/MIGRATIONS.md).
  migrationsRun: process.env.NODE_ENV !== 'production',
  synchronize: synchronisationActivee(),
  logging: process.env.NODE_ENV === 'development',
  ssl: optionsTls(),
}));
