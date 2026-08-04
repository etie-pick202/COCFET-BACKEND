import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  assainirNomFichier,
  FichierATeleverser,
  Stockage,
} from '../ports/stockage';

/** Stockage sur Cloudflare R2 (compatible S3). Utilisé en staging et en production. */
@Injectable()
export class StockageR2 implements Stockage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('R2_BUCKET');
    this.client = new S3Client({
      region: 'auto',
      endpoint: config.getOrThrow<string>('R2_ENDPOINT'),
      credentials: {
        accessKeyId: config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
      },
    });
  }

  async televerser(
    fichier: FichierATeleverser,
    prefixe = 'uploads',
  ): Promise<string> {
    const cle = `${prefixe}/${randomUUID()}-${assainirNomFichier(fichier.originalname)}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: cle,
        Body: fichier.buffer,
        ContentType: fichier.mimetype,
      }),
    );

    return cle;
  }

  urlSignee(cle: string, expirationSecondes = 3600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: cle }),
      { expiresIn: expirationSecondes },
    );
  }

  async supprimer(cle: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: cle }),
    );
  }
}
