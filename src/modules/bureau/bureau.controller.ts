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
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BureauService } from './bureau.service';
import {
  AffecterMembreDto,
  BureauPublic,
  CreerPosteDto,
  MettreAJourMembreDto,
  MettreAJourPosteDto,
} from './dto/bureau.dto';
import { MembreBureau } from './entities/membre-bureau.entity';
import { PosteBureau } from './entities/poste-bureau.entity';

@ApiTags('Bureau COCFET')
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
  @ApiResponse({ status: 409, description: 'Ce nom de poste existe déjà.' })
  creerPoste(@Body() dto: CreerPosteDto): Promise<PosteBureau> {
    return this.bureauService.creerPoste(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch('postes/:id')
  @ApiOperation({ summary: 'Modifier un poste' })
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
  @ApiResponse({ status: 409, description: 'Ce poste a déjà été occupé.' })
  supprimerPoste(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.bureauService.supprimerPoste(id);
  }

  // ───────────────────────────────  Membres  ────────────────────────────

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get(':generationId/membres')
  @ApiOperation({ summary: 'Composition d’un mandat' })
  listerMembres(
    @Param('generationId', ParseUUIDPipe) generationId: string,
  ): Promise<MembreBureau[]> {
    return this.bureauService.listerMembres(generationId);
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
  @ApiResponse({
    status: 400,
    description: 'Compte d’une autre promotion, ou adresse non confirmée.',
  })
  @ApiResponse({
    status: 409,
    description: 'Poste déjà occupé pour ce mandat.',
  })
  affecter(
    @Param('generationId', ParseUUIDPipe) generationId: string,
    @Body() dto: AffecterMembreDto,
  ): Promise<MembreBureau> {
    return this.bureauService.affecter(generationId, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch('membres/:id')
  @ApiOperation({ summary: 'Modifier la présentation d’un membre' })
  mettreAJourMembre(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourMembreDto,
  ): Promise<MembreBureau> {
    return this.bureauService.mettreAJourMembre(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete('membres/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retirer un membre du bureau' })
  retirer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.bureauService.retirer(id);
  }
}
