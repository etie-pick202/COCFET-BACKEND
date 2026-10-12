import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
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
  ApiCreatedResponse,
  ApiExcludeEndpoint,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { extname } from 'node:path';
import { Role } from '../../common/enums/role.enum';
import {
  ApiErreursAuthentification,
  ReponseErreurDto,
} from '../../common/swagger';
import { AuthOptionnelle } from '../auth/decorators/auth-optionnelle.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { StockageLocal } from './adaptateurs/stockage-local';
import { FichierTeleverseDto, UrlSigneeDto } from './dto/fichier.dto';
// `Stockage` est une interface : elle disparaît à la compilation, et
// `emitDecoratorMetadata` exige alors un import de type explicite.
import type { Stockage } from './ports/stockage';
import { STOCKAGE } from './ports/stockage';
import type { Usage } from './validation-fichier';
import { TAILLE_VIDEO_MAX, USAGES, validerFichier } from './validation-fichier';

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
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

/**
 * Dossiers dont l'URL de lecture se délivre sans connexion.
 *
 * Ce sont les médias de pages elles-mêmes publiques : une actualité, une fiche
 * d'événement ou de produit, un logo de partenaire. Sans cette ouverture, un
 * visiteur non connecté voyait des pages sans images. Tout le reste — CV,
 * justificatifs, photos de profil — exige un compte, comme avant.
 */
const PREFIXES_PUBLICS = [
  'articles',
  'videos',
  'evenements',
  'produits',
  'sponsors',
  'logos',
] as const;

/** Vrai quand la clé désigne un média de page publique. */
export function estCleDePagePublique(cle: string): boolean {
  const [prefixe, ...reste] = cle.split('/');
  return (
    reste.length > 0 &&
    !cle.includes('..') &&
    (PREFIXES_PUBLICS as readonly string[]).includes(prefixe)
  );
}

/**
 * Sert les objets du stockage local en développement.
 *
 * En staging et en production, R2 signe et sert lui-même : ce contrôleur
 * répond alors 404 sur toute requête.
 */
@ApiTags('Fichiers')
@ApiErreursAuthentification()
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
    @Headers('range') plage: string | undefined,
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
      )
      .setHeader('Accept-Ranges', 'bytes');

    // Safari et les navigateurs mobiles exigent les lectures partielles pour
    // jouer ou parcourir une vidéo : sans elles, elle ne démarre pas.
    const borne = lirePlage(plage, contenu.length);
    if (borne === 'invalide') {
      reponse
        .status(416)
        .setHeader('Content-Range', `bytes */${contenu.length}`)
        .end();
      return;
    }
    if (borne) {
      reponse
        .status(206)
        .setHeader(
          'Content-Range',
          `bytes ${borne.debut}-${borne.fin}/${contenu.length}`,
        )
        .send(contenu.subarray(borne.debut, borne.fin + 1));
      return;
    }
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
  @ApiCreatedResponse({
    description: "Cle de l'objet et URL signee temporaire.",
    type: FichierTeleverseDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Usage inconnu, fichier vide, trop volumineux ou de format inattendu.',
    type: ReponseErreurDto,
  })
  async envoyer(
    @UploadedFile() fichier: Express.Multer.File | undefined,
    @Body('usage') usage: Usage,
    @Req() requete: RequeteAuthentifiee,
  ): Promise<FichierTeleverseDto> {
    if (!fichier) {
      throw new BadRequestException('Aucun fichier reçu (champ « fichier »).');
    }
    if (usage === 'article-video') {
      throw new BadRequestException(
        'Les vidéos s’envoient par POST /fichiers/video.',
      );
    }

    return this.enregistrer(usage, fichier, requete.user.role);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post('video')
  @UseInterceptors(
    FileInterceptor('fichier', {
      // Plafond propre aux vidéos : relever celui de tout le monde exposerait
      // chaque route d'envoi à des fichiers de 40 Mo tenus en mémoire.
      limits: { fileSize: TAILLE_VIDEO_MAX, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Envoyer une vidéo d’actualité',
    description:
      'MP4, QuickTime ou WebM, 40 Mo au plus, détectés par leurs premiers ' +
      'octets. Rangée dans le dossier « videos/ ». Réservé au bureau.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['fichier'],
      properties: { fichier: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({
    description: 'Clé de la vidéo et URL signée temporaire.',
    type: FichierTeleverseDto,
  })
  async envoyerVideo(
    @UploadedFile() fichier: Express.Multer.File | undefined,
    @Req() requete: RequeteAuthentifiee,
  ): Promise<FichierTeleverseDto> {
    if (!fichier) {
      throw new BadRequestException('Aucun fichier reçu (champ « fichier »).');
    }

    return this.enregistrer('article-video', fichier, requete.user.role);
  }

  private async enregistrer(
    usage: Usage,
    fichier: Express.Multer.File,
    role: Role,
  ): Promise<FichierTeleverseDto> {
    const { prefixe, mimeReel } = validerFichier(usage, fichier, role);

    const cle = await this.stockage.televerser(
      // Le type detecte remplace celui annonce : c'est lui qui sera renvoye
      // au telechargement, et il doit decrire le contenu reel.
      { ...fichier, mimetype: mimeReel },
      prefixe,
    );

    return { cle, url: await this.stockage.urlSignee(cle), type: mimeReel };
  }

  @AuthOptionnelle()
  @Get('url-signee')
  @ApiOperation({
    summary: 'Obtenir une URL de lecture temporaire',
    description:
      "L'URL expire : un lien de photo de finissant qui ne perimerait pas " +
      'resterait valable apres la fin du mandat, et se partagerait hors de ' +
      "l'application. Sans connexion, seuls les médias de pages publiques " +
      '(actualités, événements, boutique, partenaires) sont délivrés.',
  })
  @ApiQuery({
    name: 'cle',
    description: 'Clé de stockage renvoyée au téléversement.',
    example: 'evenements/2027/6b1f9c2e-4a1f-4b7c-9d3e-8f0a1b2c3d4e.png',
  })
  @ApiOkResponse({
    description: 'URL de lecture temporaire.',
    type: UrlSigneeDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Paramètre « cle » absent.',
    type: ReponseErreurDto,
  })
  async urlSignee(
    @Query('cle') cle: string,
    @Req() requete: Request & { user?: { id: string } },
  ): Promise<UrlSigneeDto> {
    if (!cle) {
      throw new BadRequestException('Le paramètre « cle » est requis.');
    }
    if (!requete.user && !estCleDePagePublique(cle)) {
      // 404 et non 403 : ne pas confirmer qu'un CV ou un justificatif existe.
      throw new NotFoundException('Fichier introuvable.');
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
  @ApiQuery({
    name: 'cle',
    description:
      'Clé de stockage. En paramètre de requête et non en segment d’URL : ' +
      'elle contient une barre oblique.',
  })
  @ApiNoContentResponse({ description: 'Fichier supprimé.' })
  @ApiResponse({
    status: 400,
    description: 'Paramètre « cle » absent.',
    type: ReponseErreurDto,
  })
  async supprimer(@Query('cle') cle: string): Promise<void> {
    if (!cle) {
      throw new BadRequestException('Le paramètre « cle » est requis.');
    }
    await this.stockage.supprimer(cle);
  }
}

/**
 * Lit un en-tête « Range: bytes=a-b » sur un contenu de `taille` octets.
 *
 * Rend `null` sans plage (réponse complète), `invalide` hors du contenu (416),
 * ou les bornes incluses. Une seule plage : c'est tout ce que demandent les
 * lecteurs vidéo.
 */
export function lirePlage(
  entete: string | undefined,
  taille: number,
): { debut: number; fin: number } | 'invalide' | null {
  const trouve = /^bytes=(\d*)-(\d*)$/.exec(entete ?? '');
  if (!trouve || (trouve[1] === '' && trouve[2] === '')) {
    return null;
  }

  let debut: number;
  let fin: number;
  if (trouve[1] === '') {
    // « bytes=-500 » : les 500 derniers octets.
    debut = Math.max(taille - Number(trouve[2]), 0);
    fin = taille - 1;
  } else {
    debut = Number(trouve[1]);
    fin =
      trouve[2] === '' ? taille - 1 : Math.min(Number(trouve[2]), taille - 1);
  }

  return debut > fin || debut >= taille ? 'invalide' : { debut, fin };
}
