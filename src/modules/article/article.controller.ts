import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Role } from '../../common/enums/role.enum';
import { ResultatPagine } from '../../common/pagination';
import {
  ApiErreursAuthentification,
  ApiErreurValidation,
  ApiReponsePaginee,
  ReponseErreurDto,
} from '../../common/swagger';
import { AuthOptionnelle } from '../auth/decorators/auth-optionnelle.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ArticleService } from './article.service';
import {
  CreerArticleDto,
  FiltreArticleDto,
  MettreAJourArticleDto,
  PublierArticleDto,
} from './dto/article.dto';
import { Article } from './entities/article.entity';

/** La stratégie JWT pose l'utilisateur ; il est absent sur une route optionnelle. */
type Requete = Request & { user?: { id: string; role: Role } };

@ApiTags('Actualités')
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller('articles')
export class ArticleController {
  constructor(private readonly articleService: ArticleService) {}

  @AuthOptionnelle()
  @Get()
  @ApiOperation({
    summary: 'Lister les actualités',
    description:
      'Ouvert à tous. Le public ne voit que les articles parus : ni les ' +
      'brouillons, ni les archives, ni les articles programmés dont l’heure ' +
      'n’est pas venue. Seul un administrateur peut demander les autres.',
  })
  @ApiReponsePaginee(Article, 'Page d’actualités.')
  lister(
    @Query() filtre: FiltreArticleDto,
    @Req() requete: Requete,
  ): Promise<ResultatPagine<Article>> {
    return this.articleService.lister(filtre, requete.user);
  }

  @Public()
  @Get('categories')
  @ApiOperation({
    summary: 'Lister les catégories utilisées',
    description:
      'Les catégories réellement portées par des articles parus. Elles ne ' +
      'sont pas un catalogue fermé : le bureau les saisit librement, et cette ' +
      'route permet au frontend de proposer des filtres sans les coder en dur.',
  })
  @ApiOkResponse({ description: 'Catégories, par ordre alphabétique.' })
  categories(): Promise<string[]> {
    return this.articleService.categories();
  }

  @AuthOptionnelle()
  @Get('slug/:slug')
  @ApiOperation({
    summary: 'Consulter une actualité par son slug',
    description:
      'C’est la forme partagée d’une adresse d’article. Le slug est fixé à la ' +
      'création et ne suit pas les corrections du titre : une adresse déjà ' +
      'diffusée doit continuer de fonctionner.',
  })
  @ApiOkResponse({ description: 'L’article.', type: Article })
  @ApiNotFoundResponse({
    description: 'Article inexistant ou non paru.',
    type: ReponseErreurDto,
  })
  consulterParSlug(
    @Param('slug') slug: string,
    @Req() requete: Requete,
  ): Promise<Article> {
    return this.articleService.trouverParSlug(slug, requete.user);
  }

  @AuthOptionnelle()
  @Get(':id')
  @ApiOperation({ summary: 'Consulter une actualité' })
  @ApiOkResponse({ description: 'L’article.', type: Article })
  @ApiNotFoundResponse({
    description: 'Article inexistant ou non paru.',
    type: ReponseErreurDto,
  })
  consulter(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<Article> {
    return this.articleService.trouver(id, requete.user);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({
    summary: 'Rédiger une actualité',
    description:
      'Créée en brouillon : rien n’est visible ni notifié avant publication. ' +
      'L’extrait est déduit du contenu s’il est omis, et le slug du titre.',
  })
  @ApiCreatedResponse({ description: 'L’article créé.', type: Article })
  creer(
    @Body() dto: CreerArticleDto,
    @Req() requete: Requete,
  ): Promise<Article> {
    // L'auteur est celui qui rédige, jamais un identifiant reçu du client :
    // sans cela, n'importe quel administrateur pourrait signer au nom d'un autre.
    return this.articleService.creer(dto, requete.user!.id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id')
  @ApiOperation({
    summary: 'Modifier une actualité',
    description:
      'Le slug ne suit pas le titre : une correction de faute de frappe ' +
      'casserait toutes les adresses déjà partagées.',
  })
  @ApiOkResponse({ description: 'L’article mis à jour.', type: Article })
  @ApiNotFoundResponse({
    description: 'Article inconnu.',
    type: ReponseErreurDto,
  })
  mettreAJour(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourArticleDto,
  ): Promise<Article> {
    return this.articleService.mettreAJour(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/publier')
  @ApiOperation({
    summary: 'Faire paraître une actualité',
    description:
      'Sans date, la parution est immédiate et la diffusion part aussitôt. ' +
      'Avec une date future, l’article est programmé : il reste invisible et ' +
      'l’annonce partira à l’heure dite. Republier un article déjà paru ne ' +
      'renotifie personne.',
  })
  @ApiOkResponse({
    description: 'L’article publié ou programmé.',
    type: Article,
  })
  @ApiResponse({
    status: 400,
    description: 'Article archivé, ou date de parution invalide.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Article inconnu.',
    type: ReponseErreurDto,
  })
  publier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublierArticleDto,
  ): Promise<Article> {
    return this.articleService.publier(id, dto.le);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/archiver')
  @ApiOperation({ summary: 'Archiver une actualité' })
  @ApiOkResponse({ description: 'L’article archivé.', type: Article })
  @ApiNotFoundResponse({
    description: 'Article inconnu.',
    type: ReponseErreurDto,
  })
  archiver(@Param('id', ParseUUIDPipe) id: string): Promise<Article> {
    return this.articleService.archiver(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprimer une actualité',
    description:
      'Réservé aux brouillons. Un article qui a paru laisse des adresses ' +
      'partagées derrière lui : l’archivage est sa sortie prévue.',
  })
  @ApiNoContentResponse({ description: 'Article supprimé.' })
  @ApiResponse({
    status: 400,
    description: 'L’article a déjà paru.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Article inconnu.',
    type: ReponseErreurDto,
  })
  supprimer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.articleService.supprimer(id);
  }
}
