import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';
import {
  assainirNomFichier,
  FichierATeleverser,
  MOTIF_CLE,
  Stockage,
} from '../ports/stockage';

/**
 * Stockage sur disque, pour développer sans compte Cloudflare.
 *
 * Il reproduit la contrainte essentielle de R2 : l'accès se fait par URL
 * signée expirante, servie par {@link FileController}. Un adaptateur local qui
 * rendrait des chemins publics permanents laisserait écrire du code
 * incompatible avec la production.
 */
@Injectable()
export class StockageLocal implements Stockage {
  private readonly logger = new Logger(StockageLocal.name);
  private readonly racine: string;
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.racine = resolve(
      config.get<string>('STOCKAGE_LOCAL_DIR', 'var/stockage'),
    );
    // Signature liée au secret JWT : rien de nouveau à configurer, et la clé
    // reste propre à l'installation.
    this.secret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    this.baseUrl = `http://localhost:${config.get<string>('PORT', '3000')}/${config.get<string>('API_PREFIX', 'api/v1')}`;

    this.logger.warn(
      `Stockage local actif (${this.racine}) : les identifiants R2 sont absents.`,
    );
  }

  async televerser(
    fichier: FichierATeleverser,
    prefixe = 'uploads',
  ): Promise<string> {
    const cle = `${assainirNomFichier(prefixe).toLowerCase()}/${randomUUID()}-${assainirNomFichier(fichier.originalname)}`;
    const chemin = this.chemin(cle);

    await mkdir(dirname(chemin), { recursive: true });
    await writeFile(chemin, fichier.buffer);

    return cle;
  }

  urlSignee(cle: string, expirationSecondes = 3600): Promise<string> {
    const expire = Math.floor(Date.now() / 1000) + expirationSecondes;
    const parametres = new URLSearchParams({
      cle,
      expire: String(expire),
      signature: this.signer(cle, expire),
    });

    return Promise.resolve(`${this.baseUrl}/fichiers?${parametres.toString()}`);
  }

  async supprimer(cle: string): Promise<void> {
    await rm(this.chemin(cle), { force: true });
  }

  /**
   * Relit un objet après vérification de la signature et de l'échéance.
   * Appelé par le contrôleur, jamais par le code métier.
   */
  async lire(cle: string, expire: number, signature: string): Promise<Buffer> {
    if (
      !Number.isFinite(expire) ||
      expire < Math.floor(Date.now() / 1000) ||
      !this.signatureValide(cle, expire, signature)
    ) {
      // Même réponse pour un lien périmé, mal signé ou pointant vers un objet
      // absent : distinguer ces cas dirait à un curieux quelles clés existent.
      throw new NotFoundException('Lien invalide ou expiré.');
    }

    try {
      return await readFile(this.chemin(cle));
    } catch {
      throw new NotFoundException('Lien invalide ou expiré.');
    }
  }

  private chemin(cle: string): string {
    if (!MOTIF_CLE.test(cle)) {
      throw new NotFoundException('Lien invalide ou expiré.');
    }

    const chemin = resolve(join(this.racine, cle));
    // Seconde barrière, indépendante du motif : quoi qu'il arrive, le chemin
    // résolu doit rester sous la racine.
    if (chemin !== this.racine && !chemin.startsWith(this.racine + sep)) {
      throw new NotFoundException('Lien invalide ou expiré.');
    }

    return chemin;
  }

  private signer(cle: string, expire: number): string {
    return createHmac('sha256', this.secret)
      .update(`${cle}:${expire}`)
      .digest('hex');
  }

  private signatureValide(
    cle: string,
    expire: number,
    signature: string,
  ): boolean {
    const attendue = Buffer.from(this.signer(cle, expire));
    const fournie = Buffer.from(signature);

    return (
      attendue.length === fournie.length && timingSafeEqual(attendue, fournie)
    );
  }
}
