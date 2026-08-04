import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { assainirNomFichier, FichierATeleverser } from '../ports/stockage';
import { StockageLocal } from './stockage-local';

describe('StockageLocal', () => {
  let racine: string;
  let stockage: StockageLocal;

  const config = (valeurs: Record<string, string>) =>
    ({
      get: (cle: string, defaut?: string) => valeurs[cle] ?? defaut,
      getOrThrow: (cle: string) => {
        const valeur = valeurs[cle];
        if (!valeur) throw new Error(`${cle} manquante`);
        return valeur;
      },
    }) as unknown as ConfigService;

  const fichier = (
    surcharge: Partial<FichierATeleverser> = {},
  ): FichierATeleverser => ({
    originalname: 'photo.png',
    mimetype: 'image/png',
    buffer: Buffer.from('contenu'),
    ...surcharge,
  });

  const parametres = (url: string) => new URL(url).searchParams;

  beforeEach(async () => {
    racine = await mkdtemp(join(tmpdir(), 'cocfet-stockage-'));
    stockage = new StockageLocal(
      config({
        STOCKAGE_LOCAL_DIR: racine,
        JWT_ACCESS_SECRET: 'secret-de-test',
      }),
    );
  });

  afterEach(async () => {
    await rm(racine, { recursive: true, force: true });
  });

  it('téléverse puis relit le contenu via une URL signée', async () => {
    const cle = await stockage.televerser(fichier(), 'avatars');
    const p = parametres(await stockage.urlSignee(cle));

    const contenu = await stockage.lire(
      p.get('cle')!,
      Number(p.get('expire')),
      p.get('signature')!,
    );

    expect(contenu.toString()).toBe('contenu');
    expect(cle).toMatch(/^avatars\/[0-9a-f-]{36}-photo\.png$/);
  });

  it('refuse une signature falsifiée', async () => {
    const cle = await stockage.televerser(fichier());
    const p = parametres(await stockage.urlSignee(cle));

    await expect(
      stockage.lire(cle, Number(p.get('expire')), 'f'.repeat(64)),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuse une échéance repoussée sans re-signature', async () => {
    // Le réflexe d'un curieux : allonger `expire` dans l'URL. La signature
    // couvre ce champ, la modification la casse.
    const cle = await stockage.televerser(fichier());
    const p = parametres(await stockage.urlSignee(cle));

    await expect(
      stockage.lire(cle, Number(p.get('expire')) + 86400, p.get('signature')!),
    ).rejects.toThrow(NotFoundException);
  });

  it('refuse un lien périmé', async () => {
    const cle = await stockage.televerser(fichier());
    const p = parametres(await stockage.urlSignee(cle, -10));

    await expect(
      stockage.lire(cle, Number(p.get('expire')), p.get('signature')!),
    ).rejects.toThrow(NotFoundException);
  });

  it('ne laisse pas une clé remonter hors du dossier de stockage', async () => {
    // Le fichier existe réellement en dehors de la racine : si la clé était
    // suivie telle quelle, son contenu partirait.
    const secret = join(racine, '..', 'cocfet-secret.txt');
    await writeFile(secret, 'donnee-sensible');

    await expect(
      stockage.lire('uploads/../../cocfet-secret.txt', 2 ** 31, 'peu-importe'),
    ).rejects.toThrow(NotFoundException);

    await rm(secret, { force: true });
  });

  it('supprime sans échouer sur une clé déjà absente', async () => {
    const cle = await stockage.televerser(fichier());

    await stockage.supprimer(cle);
    await expect(stockage.supprimer(cle)).resolves.toBeUndefined();
  });

  it('conserve le fichier sur disque sous la racine', async () => {
    const cle = await stockage.televerser(fichier());

    await expect(readFile(join(racine, cle), 'utf8')).resolves.toBe('contenu');
  });
});

describe('assainirNomFichier', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['C:\\Windows\\system32\\cmd.exe', 'cmd.exe'],
    ['.htaccess', 'htaccess'],
    ['photo de gala (1).png', 'photo-de-gala--1-.png'],
  ])('réduit « %s » à « %s »', (entree, attendu) => {
    expect(assainirNomFichier(entree)).toBe(attendu);
  });

  it('borne la longueur et ne renvoie jamais une chaîne vide', () => {
    expect(assainirNomFichier('a'.repeat(500))).toHaveLength(100);
    expect(assainirNomFichier('...')).toBe('fichier');
  });
});
