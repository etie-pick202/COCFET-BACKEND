import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  validateSync,
} from 'class-validator';

export enum Environment {
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
  Test = 'test',
}

/**
 * Longueur minimale des secrets de signature.
 *
 * HS256 signe avec le secret tel quel : sa résistance est exactement celle de
 * la chaîne fournie. Une phrase courte se retrouve **hors ligne**, sans une
 * seule requête vers l'API, à partir d'un jeton intercepté — et forger un
 * jeton d'administrateur ne demande alors rien de plus.
 * `openssl rand -base64 48` produit une valeur adéquate.
 */
export const LONGUEUR_MINIMALE_SECRET = 32;

/** Valeurs d'exemple : elles figurent dans le dépôt, donc elles sont publiques. */
const VALEURS_INTERDITES = [
  'change-me-access-secret',
  'change-me-refresh-secret',
  'secret',
  'changeme',
];

class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL: string;

  @IsString()
  @MinLength(LONGUEUR_MINIMALE_SECRET)
  JWT_ACCESS_SECRET: string;

  @IsString()
  @MinLength(LONGUEUR_MINIMALE_SECRET)
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsOptional()
  PORT?: string;

  @IsString()
  @IsOptional()
  CORS_ORIGIN?: string;
}

/**
 * Contrôles qu'aucun décorateur n'exprime : ils portent sur la relation entre
 * plusieurs variables, ou ne valent que dans certains environnements.
 */
function verifierCoherence(
  config: EnvironmentVariables,
  brut: Record<string, unknown>,
): string[] {
  const erreurs: string[] = [];
  const production = config.NODE_ENV === Environment.Production;

  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
    // Avec un secret commun, un refresh token constitue une signature valide
    // pour le garde d'accès : il ouvrirait l'API pendant sept jours au lieu de
    // quinze minutes — et c'est précisément le jeton conservé côté client.
    erreurs.push(
      '  - JWT_ACCESS_SECRET et JWT_REFRESH_SECRET doivent différer : sinon un ' +
        "refresh token vaut jeton d'accès, pour toute sa durée de vie.",
    );
  }

  for (const cle of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    if (VALEURS_INTERDITES.includes(config[cle])) {
      erreurs.push(
        `  - ${cle} reprend une valeur d'exemple du dépôt, donc publiquement ` +
          'connue. Générez-en une avec « openssl rand -base64 48 ».',
      );
    }
  }

  if (production && brut.DATABASE_SSL !== 'true') {
    erreurs.push(
      '  - DATABASE_SSL doit valoir true en production : la connexion porte des ' +
        'données personnelles et des transactions.',
    );
  }

  if (production && brut.DATABASE_SYNCHRONIZE === 'true') {
    erreurs.push(
      '  - DATABASE_SYNCHRONIZE ne peut pas valoir true en production : TypeORM ' +
        'supprimerait les colonnes absentes des entités, donc des données.',
    );
  }

  return erreurs;
}

/**
 * Validée au démarrage : l'application refuse de booter si une variable est
 * absente ou dangereuse, plutôt que d'échouer plus tard à l'exécution — ou
 * pire, de tourner avec un secret devinable.
 */
export function validateEnv(config: Record<string, unknown>) {
  const parsed = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const messages = validateSync(parsed, { skipMissingProperties: false }).map(
    (e) =>
      `  - ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`,
  );

  messages.push(...verifierCoherence(parsed, config));

  if (messages.length > 0) {
    // Les valeurs ne sont jamais reprises dans le message : il finirait dans
    // les journaux de l'hébergeur, lisibles par bien plus de monde.
    throw new Error(
      `Configuration d'environnement invalide :\n${messages.join('\n')}`,
    );
  }

  return parsed;
}
