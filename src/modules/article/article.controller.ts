import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
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
import type { Request, Response } from 'express';
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
import { ArticleExpose, exposerArticle } from './article-expose';
import { CommentaireExpose, CommentaireService } from './commentaire.service';
import {
  CreerArticleDto,
  FiltreArticleDto,
  MettreAJourArticleDto,
  PublierArticleDto,
  PublierCommentaireDto,
} from './dto/article.dto';
import { PaginationDto } from '../../common/pagination';
import { Article } from './entities/article.entity';

/** La stratégie JWT pose l'utilisateur ; il est absent sur une route optionnelle. */
type Requete = Request & { user?: { id: string; role: Role } };

@ApiTags('Actualités')
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller('articles')
export class ArticleController {
  constructor(
    private readonly articleService: ArticleService,
    private readonly commentaireService: CommentaireService,
  ) {}

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
  async lister(
    @Query() filtre: FiltreArticleDto,
    @Req() requete: Requete,
  ): Promise<ResultatPagine<ArticleExpose>> {
    const page = await this.articleService.lister(filtre, requete.user);
    return { ...page, donnees: page.donnees.map(exposerArticle) };
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
  async consulterParSlug(
    @Param('slug') slug: string,
    @Req() requete: Requete,
  ): Promise<ArticleExpose> {
    return exposerArticle(
      await this.articleService.trouverParSlug(slug, requete.user),
    );
  }

  @Public()
  @Get('slug/:slug/couverture')
  @ApiOperation({
    summary: 'Image de couverture d’un article, à adresse stable',
    description:
      'Redirige vers l’image de couverture. Sert aux aperçus de partage : ' +
      'les robots des réseaux sociaux lisent une adresse qui ne change pas, ' +
      'alors que l’URL signée du stockage expire.',
  })
  @ApiNotFoundResponse({
    description: 'Article inconnu, non paru, ou sans image.',
    type: ReponseErreurDto,
  })
  async couverture(
    @Param('slug') slug: string,
    @Res() reponse: Response,
  ): Promise<void> {
    const url = await this.articleService.urlCouverture(slug);
    if (!url) {
      throw new NotFoundException('Cet article n’a pas d’image de couverture.');
    }
    reponse.redirect(HttpStatus.FOUND, url);
  }

  @Public()
  @Post(':id/vue')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Compter une consultation',
    description:
      'Appelée une fois par visite par la page de l’article. Sans effet sur ' +
      'un article non paru.',
  })
  @ApiNoContentResponse({ description: 'Consultation comptée.' })
  @ApiNotFoundResponse({
    description: 'Article inexistant ou non paru.',
    type: ReponseErreurDto,
  })
  enregistrerVue(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.articleService.enregistrerVue(id);
  }

  // ───────────────────────────  Commentaires  ───────────────────────────

  @AuthOptionnelle()
  @Get(':id/commentaires')
  @ApiOperation({
    summary: 'Commentaires d’une actualité',
    description:
      'Ouvert à tous. Les commentaires masqués par la modération ne sont ' +
      'visibles que de l’administration.',
  })
  @ApiOkResponse({ description: 'Page de commentaires.' })
  commentaires(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() pagination: PaginationDto,
    @Req() requete: Requete,
  ): Promise<ResultatPagine<CommentaireExpose>> {
    return this.commentaireService.lister(id, pagination, requete.user);
  }

  @ApiBearerAuth()
  @Post(':id/commentaires')
  @ApiOperation({
    summary: 'Commenter une actualité',
    description:
      'Réservé aux comptes connectés. Refusé si les commentaires sont ' +
      'fermés sur l’article, ou si la personne commente trop vite.',
  })
  @ApiCreatedResponse({ description: 'Le commentaire publié.' })
  @ApiResponse({
    status: 429,
    description: 'Trop de commentaires en peu de temps.',
    type: ReponseErreurDto,
  })
  commenter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublierCommentaireDto,
    @Req() requete: Requete,
  ): Promise<CommentaireExpose> {
    return this.commentaireService.publier(requete.user!.id, id, dto.contenu);
  }

  @ApiBearerAuth()
  @Delete('commentaires/:commentaireId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprimer un commentaire',
    description: 'Son auteur, ou l’administration.',
  })
  @ApiNoContentResponse({ description: 'Commentaire supprimé.' })
  supprimerCommentaire(
    @Param('commentaireId', ParseUUIDPipe) commentaireId: string,
    @Req() requete: Requete,
  ): Promise<void> {
    return this.commentaireService.supprimer(commentaireId, requete.user!);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post('commentaires/:commentaireId/masquer')
  @ApiOperation({
    summary: 'Masquer ou rétablir un commentaire',
    description: 'Le commentaire disparaît de la page sans être effacé.',
  })
  @ApiOkResponse({ description: 'Le commentaire modéré.' })
  masquerCommentaire(
    @Param('commentaireId', ParseUUIDPipe) commentaireId: string,
    @Body() corps: { masque?: boolean },
  ): Promise<CommentaireExpose> {
    return this.commentaireService.masquer(
      commentaireId,
      corps?.masque !== false,
    );
  }

  @AuthOptionnelle()
  @Get(':id')
  @ApiOperation({ summary: 'Consulter une actualité' })
  @ApiOkResponse({ description: 'L’article.', type: Article })
  @ApiNotFoundResponse({
    description: 'Article inexistant ou non paru.',
    type: ReponseErreurDto,
  })
  async consulter(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<ArticleExpose> {
    return exposerArticle(await this.articleService.trouver(id, requete.user));
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
  async creer(
    @Body() dto: CreerArticleDto,
    @Req() requete: Requete,
  ): Promise<ArticleExpose> {
    // L'auteur est celui qui rédige, jamais un identifiant reçu du client :
    // sans cela, n'importe quel administrateur pourrait signer au nom d'un autre.
    return exposerArticle(
      await this.articleService.creer(dto, requete.user!.id),
    );
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
  async mettreAJour(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourArticleDto,
  ): Promise<ArticleExpose> {
    return exposerArticle(await this.articleService.mettreAJour(id, dto));
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
  async publier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublierArticleDto,
  ): Promise<ArticleExpose> {
    return exposerArticle(await this.articleService.publier(id, dto.le));
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
  async archiver(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ArticleExpose> {
    return exposerArticle(await this.articleService.archiver(id));
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
