import { ConfigService } from '@nestjs/config';

const envoyer = jest.fn().mockResolvedValue({});
const urlPresignee = jest.fn().mockResolvedValue('https://r2.example/signe');

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: envoyer })),
  PutObjectCommand: jest
    .fn()
    .mockImplementation((e: unknown) => ({ entree: e })),
  GetObjectCommand: jest
    .fn()
    .mockImplementation((e: unknown) => ({ entree: e })),
  DeleteObjectCommand: jest
    .fn()
    .mockImplementation((e: unknown) => ({ entree: e })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]): Promise<string> =>
    urlPresignee(...args) as Promise<string>,
}));

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { StockageR2 } from './stockage-r2';

/**
 * Le SDK AWS est simulé : ce qui est vérifié ici, c'est ce que **nous** lui
 * transmettons — bucket, clé, type de contenu, durée de signature. Le reste
 * relève d'Amazon.
 */
describe('StockageR2', () => {
  const config = {
    getOrThrow: (cle: string) =>
      ({
        R2_BUCKET: 'cocfet',
        R2_ENDPOINT: 'https://compte.r2.cloudflarestorage.com',
        R2_ACCESS_KEY_ID: 'cle',
        R2_SECRET_ACCESS_KEY: 'secret',
      })[cle]!,
  } as unknown as ConfigService;

  const fichier = {
    originalname: 'photo.png',
    mimetype: 'image/png',
    buffer: Buffer.from('binaire'),
  };

  let stockage: StockageR2;

  beforeEach(() => {
    jest.clearAllMocks();
    stockage = new StockageR2(config);
  });

  it('configure le client sur l’endpoint R2', () => {
    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'auto',
        endpoint: 'https://compte.r2.cloudflarestorage.com',
      }),
    );
  });

  it('téléverse sous une clé préfixée et unique', async () => {
    const cle = await stockage.televerser(fichier, 'avatars');

    expect(cle).toMatch(/^avatars\/[0-9a-f-]{36}-photo\.png$/);
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'cocfet',
      Key: cle,
      Body: fichier.buffer,
      ContentType: 'image/png',
    });
    expect(envoyer).toHaveBeenCalledTimes(1);
  });

  it('assainit le nom d’origine avant de le faire entrer dans la clé', async () => {
    // Le nom vient du client : laissé tel quel, il ferait sortir l'objet du
    // préfixe attendu.
    const cle = await stockage.televerser(
      { ...fichier, originalname: '../../secret.png' },
      'avatars',
    );

    expect(cle).not.toContain('..');
    expect(cle).toMatch(/^avatars\/[0-9a-f-]{36}-secret\.png$/);
  });

  it('ne collisionne pas sur deux fichiers de même nom', async () => {
    const a = await stockage.televerser(fichier);
    const b = await stockage.televerser(fichier);

    expect(a).not.toBe(b);
  });

  it('signe une URL de lecture avec une durée bornée', async () => {
    await expect(stockage.urlSignee('avatars/x.png', 120)).resolves.toBe(
      'https://r2.example/signe',
    );

    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: 'cocfet',
      Key: 'avatars/x.png',
    });
    expect(urlPresignee).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        expiresIn: 120,
      },
    );
  });

  it('applique une expiration par défaut plutôt qu’un lien perpétuel', async () => {
    await stockage.urlSignee('avatars/x.png');

    expect(urlPresignee).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { expiresIn: 3600 },
    );
  });

  it('supprime l’objet demandé', async () => {
    await stockage.supprimer('avatars/x.png');

    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: 'cocfet',
      Key: 'avatars/x.png',
    });
  });
});
