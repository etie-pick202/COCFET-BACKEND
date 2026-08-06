import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { extname } from 'node:path';
import { Role } from '../../common/enums/role.enum';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { StockageLocal } from './adaptateurs/stockage-local';
// `Stockage` est une interface : elle disparaît à la compilation, et
// `emitDecoratorMetadata` exige alors un import de type explicite.
import type { Stockage } from './ports/stockage';
import { STOCKAGE } from './ports/stockage';
import type { Usage } from './validation-fichier';
import { USAGES, validerFichier } from './validation-fichier';

/**
 * Plafond absolu, applique par Multer avant meme que le fichier n'arrive en
 * memoire. Les limites par usage, plus fines, sont verifiees ensuite : sans ce
 * garde-fou en amont, un envoi de 500 Mo serait entierement tamponne avant
 * d'etre refuse.
 */
const TAILLE_ABSOLUE_MAX = 5 * 1024 * 1024;

/** La stratégie JWT pose l'utilisateur sur la requête. */
type RequeteAuthentifiee = Request & { user: { id: string; role: Role } };

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
@ApiTags('Fichiers')
@Controller('fichiers')
export class FileController {
  constructor(@Inject(STOCKAGE) private readonly stockage: Stockage) {}

  // Route publique : la signature de l'URL tient lieu d'autorisation, comme
  // pour une URL présignée R2.
  @Public()
  @Get()
  @ApiExcludeEndpoint()
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

  @ApiBearerAuth()
  @Post()
  @UseInterceptors(
    FileInterceptor('fichier', {
      // En memoire : les fichiers repartent aussitot vers le stockage, et un
      // fichier temporaire sur disque survivrait a un plantage du processus.
      limits: { fileSize: TAILLE_ABSOLUE_MAX, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Envoyer un fichier',
    description:
      "Le type est determine a partir des premiers octets, pas de l'en-tete " +
      'annonce par le client : un executable renomme en .png et declare ' +
      'image/png passerait tout controle fonde sur le seul champ mimetype. ' +
      "Le dossier de destination decoule de l'usage, jamais d'un chemin " +
      "fourni par l'appelant.",
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['fichier', 'usage'],
      properties: {
        fichier: { type: 'string', format: 'binary' },
        usage: { type: 'string', enum: Object.keys(USAGES) },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Cle de l'objet et URL signee temporaire.",
  })
  @ApiResponse({
    status: 400,
    description:
      'Usage inconnu, fichier vide, trop volumineux ou de format inattendu.',
  })
  async envoyer(
    @UploadedFile() fichier: Express.Multer.File | undefined,
    @Body('usage') usage: Usage,
    @Req() requete: RequeteAuthentifiee,
  ): Promise<{ cle: string; url: string; type: string }> {
    if (!fichier) {
      throw new BadRequestException('Aucun fichier reçu (champ « fichier »).');
    }

    const { prefixe, mimeReel } = validerFichier(
      usage,
      fichier,
      requete.user.role,
    );

    const cle = await this.stockage.televerser(
      // Le type detecte remplace celui annonce : c'est lui qui sera renvoye
      // au telechargement, et il doit decrire le contenu reel.
      { ...fichier, mimetype: mimeReel },
      prefixe,
    );

    return { cle, url: await this.stockage.urlSignee(cle), type: mimeReel };
  }

  @ApiBearerAuth()
  @Get('url-signee')
  @ApiOperation({
    summary: 'Obtenir une URL de lecture temporaire',
    description:
      "L'URL expire : un lien de photo de finissant qui ne perimerait pas " +
      'resterait valable apres la fin du mandat, et se partagerait hors de ' +
      "l'application.",
  })
  async urlSignee(@Query('cle') cle: string): Promise<{ url: string }> {
    if (!cle) {
      throw new BadRequestException('Le paramètre « cle » est requis.');
    }
    return { url: await this.stockage.urlSignee(cle) };
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  // La cle passe en parametre de requete plutot qu'en segment d'URL : elle
  // contient une barre oblique, qu'un segment de chemin decouperait.
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprimer un fichier',
    description:
      "Reserve au bureau : la cle seule ne dit pas a quelle entite l'objet " +
      'est rattache, et rien ne garantirait donc que le demandeur en est le ' +
      'proprietaire.',
  })
  async supprimer(@Query('cle') cle: string): Promise<void> {
    if (!cle) {
      throw new BadRequestException('Le paramètre « cle » est requis.');
    }
    await this.stockage.supprimer(cle);
  }
}
