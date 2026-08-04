import {
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Query,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { extname } from 'path';
import { Public } from '../auth/decorators/public.decorator';
import { StockageLocal } from './adaptateurs/stockage-local';
// `Stockage` est une interface : elle disparaît à la compilation, et
// `emitDecoratorMetadata` exige alors un import de type explicite.
import type { Stockage } from './ports/stockage';
import { STOCKAGE } from './ports/stockage';

/**
 * Types servis tels quels. Tout le reste part en pièce jointe : une page HTML
 * téléversée puis affichée en ligne s'exécuterait dans l'origine de l'API,
 * avec accès aux cookies du domaine.
 */
const TYPES_AFFICHABLES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

/**
 * Sert les objets du stockage local en développement.
 *
 * En staging et en production, R2 signe et sert lui-même : ce contrôleur
 * répond alors 404 sur toute requête.
 */
@ApiExcludeController()
@Controller('fichiers')
export class FileController {
  constructor(@Inject(STOCKAGE) private readonly stockage: Stockage) {}

  // Route publique : la signature de l'URL tient lieu d'autorisation, comme
  // pour une URL présignée R2.
  @Public()
  @Get()
  @Header('X-Content-Type-Options', 'nosniff')
  async servir(
    @Query('cle') cle: string,
    @Query('expire') expire: string,
    @Query('signature') signature: string,
    @Res() reponse: Response,
  ): Promise<void> {
    if (!(this.stockage instanceof StockageLocal)) {
      throw new NotFoundException();
    }
    if (!cle || !expire || !signature) {
      throw new NotFoundException('Lien invalide ou expiré.');
    }

    const contenu = await this.stockage.lire(cle, Number(expire), signature);
    const type = TYPES_AFFICHABLES[extname(cle).toLowerCase()];

    reponse
      .type(type ?? 'application/octet-stream')
      .setHeader(
        'Content-Disposition',
        type ? 'inline' : 'attachment; filename="fichier"',
      );
    reponse.send(contenu);
  }
}
