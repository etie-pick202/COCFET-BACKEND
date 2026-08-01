import { registerAs } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

type OptionsTls = false | { ca?: string; rejectUnauthorized: boolean };

/**
 * Options TLS de la connexion à la base.
 *
 * La vérification du certificat est **active par défaut** : sans elle, la
 * connexion accepte n'importe quel certificat, y compris celui d'un attaquant
 * interposé, ce qui expose les données personnelles et les transactions.
 *
 * Certains hébergeurs présentent un certificat auto-signé et imposent de
 * désactiver cette vérification. C'est un choix dégradé, qui doit rester
 * explicite : il faut alors positionner DATABASE_SSL_REJECT_UNAUTHORIZED=false.
 * La bonne réponse reste de fournir le certificat de l'autorité via
 * DATABASE_SSL_CA plutôt que de renoncer à toute vérification.
 */
function optionsTls(): OptionsTls {
  if (process.env.DATABASE_SSL !== 'true') {
    return false;
  }

  const ca = process.env.DATABASE_SSL_CA;
  if (ca) {
    return { ca, rejectUnauthorized: true };
  }

  return {
    rejectUnauthorized:
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
}

/**
 * `synchronize` n'est activé qu'en développement : en production le schéma est
 * appliqué via les migrations TypeORM (`typeorm migration:run`).
 */
export default registerAs('database', (): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  autoLoadEntities: true,
  synchronize: process.env.NODE_ENV === 'development',
  logging: process.env.NODE_ENV === 'development',
  ssl: optionsTls(),
}));
