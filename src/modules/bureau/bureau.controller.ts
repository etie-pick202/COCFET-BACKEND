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
import { Role } from '../../common/enums/role.enum';
import {
  ApiErreursAuthentification,
  ApiErreurValidation,
  ReponseErreurDto,
} from '../../common/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BureauService } from './bureau.service';
import {
  AffecterMembreDto,
  BureauPublic,
  CreerPosteDto,
  MembreExpose,
  MettreAJourMembreDto,
  MettreAJourPosteDto,
} from './dto/bureau.dto';
import { PosteBureau } from './entities/poste-bureau.entity';

@ApiTags('Bureau COCFET')
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller('bureau')
export class BureauController {
  constructor(private readonly bureauService: BureauService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Composition du bureau en cours',
    description:
      'Page publique « Le bureau ». Ni adresse, ni identifiant de compte : ' +
      'publier les adresses de la promotion les livrerait aux robots ' +
      'collecteurs. Renvoie null tant qu’aucun mandat n’est actif.',
  })
  @ApiOkResponse({
    description: 'La composition publiée, ou null si aucun mandat n’est actif.',
    type: BureauPublic,
  })
  bureauPublic(): Promise<BureauPublic | null> {
    return this.bureauService.bureauPublic();
  }

  // ───────────────────────────────  Postes  ─────────────────────────────
  // Déclarés avant « :generationId » : sinon « postes » serait interprété
  // comme un identifiant, et le routeur répondrait 400 sur une route valide.

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('postes')
  @ApiOperation({ summary: 'Lister les postes du bureau' })
  @ApiOkResponse({
    description: 'Le catalogue des postes.',
    type: [PosteBureau],
  })
  listerPostes(): Promise<PosteBureau[]> {
    return this.bureauService.listerPostes();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post('postes')
  @ApiOperation({
    summary: 'Créer un poste',
    description:
      'Le catalogue est une donnée, pas une énumération : chaque mandat ' +
      's’organise à sa façon, sans redéploiement.',
  })
  @ApiCreatedResponse({ description: 'Le poste créé.', type: PosteBureau })
  @ApiResponse({
    status: 409,
    description: 'Ce nom de poste existe déjà.',
    type: ReponseErreurDto,
  })
  creerPoste(@Body() dto: CreerPosteDto): Promise<PosteBureau> {
    return this.bureauService.creerPoste(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch('postes/:id')
  @ApiOperation({ summary: 'Modifier un poste' })
  @ApiOkResponse({ description: 'Le poste mis à jour.', type: PosteBureau })
  @ApiNotFoundResponse({
    description: 'Poste inconnu.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Ce nom de poste existe déjà.',
    type: ReponseErreurDto,
  })
  mettreAJourPoste(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourPosteDto,
  ): Promise<PosteBureau> {
    return this.bureauService.mettreAJourPoste(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete('postes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprimer un poste',
    description:
      'Refusé dès qu’un mandat l’a attribué : effacer le poste effacerait la ' +
      'trace de qui l’a occupé. Un poste devenu inutile se retire en ne le ' +
      'pourvoyant plus.',
  })
  @ApiNoContentResponse({ description: 'Poste supprimé.' })
  @ApiNotFoundResponse({
    description: 'Poste inconnu.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Ce poste a déjà été occupé.',
    type: ReponseErreurDto,
  })
  supprimerPoste(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.bureauService.supprimerPoste(id);
  }

  // ───────────────────────────────  Membres  ────────────────────────────

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get(':generationId/membres')
  @ApiOperation({
    summary: 'Composition d’un mandat',
    description:
      'Chaque titulaire est projeté champ par champ : la réponse porte de quoi ' +
      'l’identifier et le recontacter, jamais l’entité de compte entière.',
  })
  @ApiOkResponse({
    description: 'Les postes pourvus pour ce mandat.',
    type: [MembreExpose],
  })
  @ApiNotFoundResponse({
    description: 'Génération inconnue.',
    type: ReponseErreurDto,
  })
  listerMembres(
    @Param('generationId', ParseUUIDPipe) generationId: string,
  ): Promise<MembreExpose[]> {
    return this.bureauService.composition(generationId);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':generationId/membres')
  @ApiOperation({
    summary: 'Désigner le titulaire d’un poste',
    description:
      'Le titulaire doit être un finissant de cette génération : le COCFET ' +
      'est le comité d’organisation de la cérémonie de fin d’étude, composé ' +
      'de ceux qui la vivent. C’est ainsi que le bureau sortant constitue le ' +
      'bureau entrant.',
  })
  @ApiCreatedResponse({ description: 'Le membre affecté.', type: MembreExpose })
  @ApiResponse({
    status: 400,
    description: 'Compte d’une autre promotion, ou adresse non confirmée.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Génération, poste ou compte inconnu.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Poste déjà occupé pour ce mandat.',
    type: ReponseErreurDto,
  })
  affecter(
    @Param('generationId', ParseUUIDPipe) generationId: string,
    @Body() dto: AffecterMembreDto,
  ): Promise<MembreExpose> {
    return this.bureauService.affecter(generationId, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch('membres/:id')
  @ApiOperation({ summary: 'Modifier la présentation d’un membre' })
  @ApiOkResponse({ description: 'Le membre mis à jour.', type: MembreExpose })
  @ApiNotFoundResponse({
    description: 'Membre inconnu.',
    type: ReponseErreurDto,
  })
  mettreAJourMembre(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourMembreDto,
  ): Promise<MembreExpose> {
    return this.bureauService.mettreAJourMembre(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete('membres/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retirer un membre du bureau' })
  @ApiNoContentResponse({ description: 'Membre retiré.' })
  @ApiNotFoundResponse({
    description: 'Membre inconnu.',
    type: ReponseErreurDto,
  })
  retirer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.bureauService.retirer(id);
  }
}
