import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    delete process.env.DATABASE_SSL_CA_FILE;
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

  describe('autorité fournie par fichier', () => {
    let dossier: string;

    beforeEach(() => {
      dossier = mkdtempSync(join(tmpdir(), 'cocfet-tls-'));
    });

    afterEach(() => {
      rmSync(dossier, { recursive: true, force: true });
    });

    it('lit le certificat depuis DATABASE_SSL_CA_FILE', () => {
      // La forme utilisée en conteneur : le PEM est monté, pas recopié dans
      // une variable où ses retours à la ligne dépendraient de l'outil.
      const chemin = join(dossier, 'ca.crt');
      writeFileSync(chemin, '-----BEGIN CERTIFICATE-----\nFICHIER\n');
      process.env.DATABASE_SSL = 'true';
      process.env.DATABASE_SSL_CA_FILE = chemin;

      expect(optionsTls()).toEqual({
        ca: '-----BEGIN CERTIFICATE-----\nFICHIER\n',
        rejectUnauthorized: true,
      });
    });

    it('préfère la valeur directe quand les deux sont posées', () => {
      const chemin = join(dossier, 'ca.crt');
      writeFileSync(chemin, 'DEPUIS-LE-FICHIER');
      process.env.DATABASE_SSL = 'true';
      process.env.DATABASE_SSL_CA = 'DEPUIS-LA-VARIABLE';
      process.env.DATABASE_SSL_CA_FILE = chemin;

      expect(optionsTls()).toEqual({
        ca: 'DEPUIS-LA-VARIABLE',
        rejectUnauthorized: true,
      });
    });

    it('lève sur un fichier absent plutôt que de continuer sans autorité', () => {
      // Continuer sans l'autorité ferait refuser un certificat légitime, et
      // l'erreur parlerait de certificat au lieu du fichier manquant.
      process.env.DATABASE_SSL = 'true';
      process.env.DATABASE_SSL_CA_FILE = join(dossier, 'absent.crt');

      expect(() => optionsTls()).toThrow(/ENOENT/);
    });

    it("n'ouvre pas le fichier quand TLS est désactivé", () => {
      process.env.DATABASE_SSL_CA_FILE = join(dossier, 'absent.crt');

      expect(optionsTls()).toBe(false);
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
