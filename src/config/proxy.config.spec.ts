import { proxyDeConfiance } from './proxy.config';

/**
 * Sans proxy de confiance, derrière Caddy ou Railway, tous les visiteurs
 * partagent l'adresse du proxy — et donc un seul compteur de limitation de
 * débit. Avec une confiance trop large, chacun choisit son adresse. Les deux
 * bords comptent.
 */
describe('proxyDeConfiance', () => {
  it("n'accorde aucune confiance quand rien n'est configuré", () => {
    // Le comportement d'origine, sans proxy : le développement local et les
    // tests e2e se connectent directement à l'application.
    expect(proxyDeConfiance(undefined)).toBe(false);
    expect(proxyDeConfiance('')).toBe(false);
    expect(proxyDeConfiance('   ')).toBe(false);
    expect(proxyDeConfiance('false')).toBe(false);
  });

  it('lit un nombre de sauts comme un nombre', () => {
    // Express distingue 1 (un saut) de « 1 » (une adresse) : la conversion
    // n'est pas cosmétique.
    expect(proxyDeConfiance('1')).toBe(1);
    expect(proxyDeConfiance(' 2 ')).toBe(2);
  });

  it('transmet une liste de plages telle quelle', () => {
    expect(proxyDeConfiance('loopback, uniquelocal')).toBe(
      'loopback, uniquelocal',
    );
  });

  it('refuse la confiance totale', () => {
    // Elle ferait lire l'adresse dans un en-tête que le client écrit lui-même.
    expect(() => proxyDeConfiance('true')).toThrow(/X-Forwarded-For/);
  });
});
