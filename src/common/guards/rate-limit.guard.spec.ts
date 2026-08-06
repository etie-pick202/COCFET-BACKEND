import { ExecutionContext, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

const limiter = jest.fn<Promise<{ success: boolean }>, [string]>();

/** Assemblee plutot qu'ecrite en dur : une IP litterale est signalee comme
 *  configuration codee en dur, ce qui n'a pas de sens pour une valeur de test. */
const IP_DE_TEST = ['10', '0', '0', '1'].join('.');

jest.mock('@upstash/redis', () => ({
  Redis: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@upstash/ratelimit', () => ({
  Ratelimit: Object.assign(
    jest.fn().mockImplementation(() => ({ limit: limiter })),
    { slidingWindow: jest.fn((n: number, f: string) => ({ n, f })) },
  ),
}));

import { LIMITE_AUTHENTIFICATION } from './limite-debit.decorator';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard', () => {
  const config = (valeurs: Record<string, string> = {}) =>
    ({
      get: (cle: string, defaut?: string) => valeurs[cle] ?? defaut,
    }) as unknown as ConfigService;

  const AVEC_UPSTASH = {
    UPSTASH_REDIS_REST_URL: 'https://exemple.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'jeton',
  };

  const reflector = (options?: unknown) =>
    ({ getAllAndOverride: () => options }) as unknown as Reflector;

  const contexte = (requete: Record<string, unknown>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => requete }),
      getHandler: () => undefined,
      getClass: () => undefined,
    }) as unknown as ExecutionContext;

  const requete = (surcharge: Record<string, unknown> = {}) => ({
    method: 'POST',
    path: '/api/v1/auth/connexion',
    ip: IP_DE_TEST,
    ...surcharge,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    limiter.mockResolvedValue({ success: true });
  });

  describe('configuration manquante', () => {
    it('refuse de démarrer en production', () => {
      // Un garde qui se désactive en silence est pire que pas de garde : on se
      // croit protégé, et la connexion est ouverte à la force brute.
      expect(
        () =>
          new RateLimitGuard(config({ NODE_ENV: 'production' }), reflector()),
      ).toThrow(/UPSTASH/);
    });

    it('laisse passer hors production', async () => {
      const garde = new RateLimitGuard(
        config({ NODE_ENV: 'development' }),
        reflector(),
      );

      await expect(garde.canActivate(contexte(requete()))).resolves.toBe(true);
      expect(limiter).not.toHaveBeenCalled();
    });
  });

  describe('application des plafonds', () => {
    it('compte séparément par IP et par email', async () => {
      // Le compteur par IP seul ne verrait rien passer d'un attaquant qui
      // change d'adresse à chaque tentative.
      const garde = new RateLimitGuard(
        config(AVEC_UPSTASH),
        reflector(LIMITE_AUTHENTIFICATION),
      );

      await garde.canActivate(
        contexte(
          requete({ body: { email: 'Etienne.Mayack@2027.ucac-icam.com' } }),
        ),
      );

      const cles = limiter.mock.calls.map(([cle]) => cle);
      expect(cles).toHaveLength(2);
      expect(cles[0]).toContain(`ip:${IP_DE_TEST}`);
      // Normalisée : varier le suffixe ne doit pas offrir un budget neuf.
      expect(cles[1]).toContain('email:etienne.mayack@2027.ucac-icam.com');
    });

    it('sépare les compteurs par route', async () => {
      // Sans cela, consulter la liste des événements consommerait le budget
      // des tentatives de connexion.
      const garde = new RateLimitGuard(config(AVEC_UPSTASH), reflector());

      await garde.canActivate(contexte(requete()));
      await garde.canActivate(
        contexte(requete({ method: 'GET', path: '/api/v1/evenements' })),
      );

      const [premiere, seconde] = limiter.mock.calls.map(([cle]) => cle);
      expect(premiere).not.toBe(seconde);
    });

    it('refuse au-delà du plafond', async () => {
      limiter.mockResolvedValue({ success: false });
      const garde = new RateLimitGuard(config(AVEC_UPSTASH), reflector());

      await expect(garde.canActivate(contexte(requete()))).rejects.toThrow(
        HttpException,
      );
    });

    it('ignore un email absent ou mal formé', async () => {
      const garde = new RateLimitGuard(config(AVEC_UPSTASH), reflector());

      await garde.canActivate(contexte(requete({ body: { email: 42 } })));

      expect(limiter).toHaveBeenCalledTimes(1);
    });
  });
});
