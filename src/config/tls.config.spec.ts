import { optionsTls } from './tls.config';

/**
 * Ces règles gouvernent la vérification du certificat de la base. Une
 * régression ici rendrait la connexion vulnérable à un attaquant interposé,
 * sans qu'aucun autre test ne s'en aperçoive : la connexion fonctionnerait
 * toujours, simplement sans vérifier à qui elle parle.
 */
describe('optionsTls', () => {
  const environnementInitial = process.env;

  beforeEach(() => {
    process.env = { ...environnementInitial };
    delete process.env.DATABASE_SSL;
    delete process.env.DATABASE_SSL_CA;
    delete process.env.DATABASE_SSL_REJECT_UNAUTHORIZED;
  });

  afterAll(() => {
    process.env = environnementInitial;
  });

  it('désactive TLS quand DATABASE_SSL ne vaut pas exactement "true"', () => {
    expect(optionsTls()).toBe(false);

    process.env.DATABASE_SSL = 'false';
    expect(optionsTls()).toBe(false);

    // Une valeur approchante ne doit pas activer TLS par accident.
    process.env.DATABASE_SSL = 'TRUE';
    expect(optionsTls()).toBe(false);
  });

  it('vérifie le certificat par défaut lorsque TLS est activé', () => {
    process.env.DATABASE_SSL = 'true';

    expect(optionsTls()).toEqual({ rejectUnauthorized: true });
  });

  it("utilise l'autorité fournie et maintient la vérification", () => {
    process.env.DATABASE_SSL = 'true';
    process.env.DATABASE_SSL_CA = '-----BEGIN CERTIFICATE-----FAKE';

    expect(optionsTls()).toEqual({
      ca: '-----BEGIN CERTIFICATE-----FAKE',
      rejectUnauthorized: true,
    });
  });

  it('ignore la désactivation demandée quand une autorité est fournie', () => {
    process.env.DATABASE_SSL = 'true';
    process.env.DATABASE_SSL_CA = '-----BEGIN CERTIFICATE-----FAKE';
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = 'false';

    // Fournir une autorité rend la désactivation inutile : on ne la suit pas.
    expect(optionsTls()).toEqual({
      ca: '-----BEGIN CERTIFICATE-----FAKE',
      rejectUnauthorized: true,
    });
  });

  it('ne désactive la vérification que sur la valeur exacte "false"', () => {
    process.env.DATABASE_SSL = 'true';

    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = 'false';
    expect(optionsTls()).toEqual({ rejectUnauthorized: false });

    // Toute autre valeur doit laisser la vérification active : une faute de
    // frappe dans la configuration ne doit pas ouvrir la connexion.
    for (const valeur of ['0', 'no', 'False', 'FALSE', '', 'oui']) {
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = valeur;
      expect(optionsTls()).toEqual({ rejectUnauthorized: true });
    }
  });
});
