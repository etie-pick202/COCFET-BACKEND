import 'reflect-metadata';
import { LONGUEUR_MINIMALE_SECRET, validateEnv } from './env.validation';

describe('validateEnv', () => {
  const acces = 'a'.repeat(LONGUEUR_MINIMALE_SECRET);
  const refresh = 'r'.repeat(LONGUEUR_MINIMALE_SECRET);

  const base = (surcharge: Record<string, unknown> = {}) => ({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cocfet',
    JWT_ACCESS_SECRET: acces,
    JWT_REFRESH_SECRET: refresh,
    ...surcharge,
  });

  it('accepte une configuration complète', () => {
    expect(() => validateEnv(base())).not.toThrow();
  });

  it('refuse une base de données absente', () => {
    expect(() => validateEnv(base({ DATABASE_URL: '' }))).toThrow(
      /DATABASE_URL/,
    );
  });

  it('refuse un secret trop court', () => {
    // HS256 signe avec le secret tel quel : une phrase courte se retrouve hors
    // ligne à partir d'un seul jeton intercepté.
    expect(() =>
      validateEnv(base({ JWT_ACCESS_SECRET: 'trop-court' })),
    ).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuse deux secrets identiques', () => {
    // Le cas dangereux : un refresh token vaudrait alors jeton d'accès, sept
    // jours durant, alors que c'est celui que le client conserve.
    expect(() => validateEnv(base({ JWT_REFRESH_SECRET: acces }))).toThrow(
      /différer/,
    );
  });

  it('refuse une valeur d’exemple du dépôt, même de longueur suffisante', () => {
    expect(() =>
      validateEnv(
        base({ JWT_ACCESS_SECRET: 'change-me-access-secret'.padEnd(40, '-') }),
      ),
    ).not.toThrow();

    expect(() =>
      validateEnv({
        ...base(),
        JWT_ACCESS_SECRET: 'change-me-access-secret',
      }),
    ).toThrow();
  });

  it('exige TLS sur la base en production', () => {
    expect(() =>
      validateEnv(base({ NODE_ENV: 'production', DATABASE_SSL: 'false' })),
    ).toThrow(/DATABASE_SSL/);

    expect(() =>
      validateEnv(base({ NODE_ENV: 'production', DATABASE_SSL: 'true' })),
    ).not.toThrow();
  });

  it('interdit synchronize en production', () => {
    // TypeORM y supprimerait les colonnes absentes des entités, donc des
    // données réelles.
    expect(() =>
      validateEnv(
        base({
          NODE_ENV: 'production',
          DATABASE_SSL: 'true',
          DATABASE_SYNCHRONIZE: 'true',
        }),
      ),
    ).toThrow(/DATABASE_SYNCHRONIZE/);
  });

  it('ne reprend jamais la valeur du secret dans le message d’erreur', () => {
    // Ce message finit dans les journaux de l'hébergeur, lisibles par bien
    // plus de monde que le tableau de bord des variables.
    const secretReel = 'mon-vrai-secret-de-production-a-ne-pas-divulguer';

    try {
      validateEnv(
        base({ JWT_ACCESS_SECRET: secretReel, JWT_REFRESH_SECRET: secretReel }),
      );
      fail('la validation aurait dû échouer');
    } catch (erreur) {
      expect((erreur as Error).message).not.toContain(secretReel);
    }
  });

  it('signale toutes les erreurs d’un coup', () => {
    // Corriger la configuration en dix redémarrages successifs est pénible :
    // on veut la liste complète du premier coup.
    try {
      validateEnv({ NODE_ENV: 'production' });
      fail('la validation aurait dû échouer');
    } catch (erreur) {
      const message = (erreur as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('JWT_ACCESS_SECRET');
      expect(message).toContain('DATABASE_SSL');
    }
  });
});
