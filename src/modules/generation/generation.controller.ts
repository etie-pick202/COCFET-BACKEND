import {
  BadRequestException,
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
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';
import {
  ApiErreursAuthentification,
  ApiErreurValidation,
  ReponseErreurDto,
} from '../../common/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { DesignerLogoDto } from '../bureau/dto/bureau.dto';
import {
  CleLogoDto,
  CreerGenerationDto,
  MettreAJourGenerationDto,
  ThemeGeneration,
} from './dto/generation.dto';
import { Generation } from './entities/generation.entity';
import { GenerationService } from './generation.service';
import { IdentiteVisuelleService } from './identite-visuelle.service';

@ApiTags('Générations')
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller('generations')
export class GenerationController {
  /**
   * L'invalidation de la charte est déclenchée ici, et non dans
   * `GenerationService` : c'est `IdentiteVisuelleService` qui dépend du
   * service des générations, l'inverse formerait un cycle. Le contrôleur, lui,
   * voit les deux.
   */
  constructor(
    private readonly generationService: GenerationService,
    private readonly identiteVisuelle: IdentiteVisuelleService,
  ) {}

  @Public()
  @Get('theme')
  @ApiOperation({
    summary: 'Thème de la génération en cours',
    description:
      "Chargé au démarrage du frontend pour s'habiller. Renvoie des valeurs " +
      "neutres plutôt qu'une erreur quand aucune génération n'est active : " +
      'une plateforme fraîchement installée doit pouvoir s’afficher.',
  })
  @ApiOkResponse({
    description: 'Thème courant, ou valeurs neutres si aucun mandat en cours.',
    type: ThemeGeneration,
  })
  theme(): Promise<ThemeGeneration> {
    return this.generationService.theme();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Lister les générations' })
  @ApiOkResponse({
    description: 'Toutes les générations, archives comprises.',
    type: [Generation],
  })
  lister(): Promise<Generation[]> {
    return this.generationService.lister();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get(':id')
  @ApiOperation({ summary: 'Consulter une génération' })
  @ApiOkResponse({ description: 'La génération demandée.', type: Generation })
  @ApiNotFoundResponse({
    description: 'Génération inconnue.',
    type: ReponseErreurDto,
  })
  trouver(@Param('id', ParseUUIDPipe) id: string): Promise<Generation> {
    return this.generationService.trouver(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({
    summary: 'Créer une génération',
    description:
      "Créée inactive : l'activation bascule toute la plateforme et mérite un " +
      'geste explicite.',
  })
  @ApiCreatedResponse({ description: 'La génération créée.', type: Generation })
  @ApiResponse({
    status: 409,
    description: 'Cette année existe déjà.',
    type: ReponseErreurDto,
  })
  creer(@Body() dto: CreerGenerationDto): Promise<Generation> {
    return this.generationService.creer(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: 'Modifier une génération' })
  @ApiOkResponse({
    description: 'La génération mise à jour.',
    type: Generation,
  })
  @ApiNotFoundResponse({
    description: 'Génération inconnue.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Génération archivée, ou année déjà prise.',
    type: ReponseErreurDto,
  })
  async mettreAJour(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourGenerationDto,
  ): Promise<Generation> {
    const generation = await this.generationService.mettreAJour(id, dto);
    this.invaliderSiEnCours(generation);
    return generation;
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id/logo')
  @ApiOperation({
    summary: 'Désigner le logo utilisé par la plateforme',
    description:
      'Un bureau fait souvent décliner plusieurs logos. Celui-ci doit figurer ' +
      'parmi ceux déposés : sans ce contrôle, une faute de frappe afficherait ' +
      'une image inexistante.',
  })
  @ApiOkResponse({
    description: 'La génération mise à jour.',
    type: Generation,
  })
  @ApiResponse({
    status: 400,
    description: 'Logo non déposé pour cette génération.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Génération inconnue.',
    type: ReponseErreurDto,
  })
  async designerLogo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DesignerLogoDto,
  ): Promise<Generation> {
    const generation = await this.generationService.designerLogo(id, dto.logo);
    this.invaliderSiEnCours(generation);
    return generation;
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/logos')
  @ApiOperation({
    summary: 'Rattacher une déclinaison de logo',
    description:
      'La clé doit provenir d’un envoi fait avec l’usage « logo » : sans ce ' +
      'contrôle, n’importe quel objet du stockage pourrait être rattaché au ' +
      'mandat, y compris le CV d’un finissant, que les documents sortants ' +
      'iraient alors lire. Idempotent : redéposer la même clé ne la duplique pas.',
  })
  @ApiOkResponse({
    description: 'La génération mise à jour.',
    type: Generation,
  })
  @ApiResponse({
    status: 409,
    description: 'Trop de déclinaisons pour ce mandat.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Génération inconnue.',
    type: ReponseErreurDto,
  })
  async ajouterLogo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CleLogoDto,
  ): Promise<Generation> {
    const generation = await this.generationService.ajouterLogo(id, dto.logo);
    this.invaliderSiEnCours(generation);
    return generation;
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  // La clé passe en paramètre de requête et non en segment d'URL : elle
  // contient une barre oblique, qu'un segment de chemin découperait.
  @Delete(':id/logos')
  @ApiOperation({
    summary: 'Retirer une déclinaison de logo',
    description:
      'Retire la déclinaison du mandat **et supprime l’objet du stockage** : ' +
      'la conserver laisserait un fichier payant que plus rien ne référence, ' +
      'et qu’aucune purge ne saurait distinguer d’un objet utile. Retirer la ' +
      'déclinaison qui habille la plateforme lève la désignation — la charte ' +
      'retombe sur ses couleurs neutres.',
  })
  @ApiQuery({
    name: 'logo',
    description: 'Clé de stockage de la déclinaison à retirer.',
    example: 'logos/6b1f9c2e-4a1f-4b7c-9d3e-8f0a1b2c3d4e.png',
  })
  @ApiOkResponse({
    description: 'La génération mise à jour.',
    type: Generation,
  })
  @ApiNotFoundResponse({
    description: 'Génération inconnue, ou logo non déposé pour ce mandat.',
    type: ReponseErreurDto,
  })
  async retirerLogo(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('logo') logo: string,
  ): Promise<Generation> {
    if (!logo) {
      throw new BadRequestException('Le paramètre « logo » est requis.');
    }

    const generation = await this.generationService.retirerLogo(id, logo);
    this.invaliderSiEnCours(generation);
    return generation;
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/activer')
  @ApiOperation({
    summary: 'Activer une génération',
    description:
      'Bascule le mandat : désactive la précédente, recalcule le statut de ' +
      'finissant, et opère la passation d’administration — les titulaires des ' +
      'postes administrateurs entrants sont promus, les sortants devenus ' +
      'alumni rétrogradés. Le tout dans une seule transaction. Refusé tant ' +
      'que les postes clés du bureau ne sont pas pourvus.',
  })
  @ApiOkResponse({
    description: 'La génération devenue active.',
    type: Generation,
  })
  @ApiResponse({
    status: 400,
    description: 'Bureau incomplet.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Génération archivée.',
    type: ReponseErreurDto,
  })
  async activer(@Param('id', ParseUUIDPipe) id: string): Promise<Generation> {
    const generation = await this.generationService.activer(id);
    // Toujours : la passation change le mandat, donc la charte.
    this.identiteVisuelle.invalider();
    return generation;
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/archiver')
  @ApiOperation({
    summary: 'Archiver une génération',
    description:
      'Fige les statistiques du mandat. Elles sont calculées à cet instant et ' +
      'ne bougent plus : les recalculer plus tard donnerait des chiffres ' +
      'différents, et le bilan ne serait jamais deux fois le même.',
  })
  @ApiOkResponse({
    description: 'La génération archivée, statistiques figées.',
    type: Generation,
  })
  @ApiResponse({
    status: 409,
    description: 'La génération est en cours de mandat.',
    type: ReponseErreurDto,
  })
  archiver(@Param('id', ParseUUIDPipe) id: string): Promise<Generation> {
    return this.generationService.archiver(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprimer une génération',
    description:
      'Réservé à une génération créée par erreur : ni la génération en cours, ' +
      'ni une archive, qui conserve le bilan de son mandat.',
  })
  @ApiNoContentResponse({ description: 'Génération supprimée.' })
  @ApiResponse({
    status: 409,
    description: 'Génération active ou archivée.',
    type: ReponseErreurDto,
  })
  supprimer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.generationService.supprimer(id);
  }

  /**
   * Vide le cache de la charte quand le mandat retouché est celui en cours.
   *
   * Sans cela, un changement de couleur ou de logo mettrait jusqu'à cinq
   * minutes à se voir dans les messages — le temps que le cache expire. Une
   * génération inactive, elle, n'habille rien : inutile de forcer une relecture
   * de la base et du stockage.
   */
  private invaliderSiEnCours(generation: Generation): void {
    if (generation.isActive) {
      this.identiteVisuelle.invalider();
    }
  }
}
