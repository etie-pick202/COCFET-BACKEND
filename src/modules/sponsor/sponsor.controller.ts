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
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ChangerPalierDto,
  CreerPalierDto,
  FiltreSponsorDto,
  MettreAJourPalierDto,
  MettreAJourSponsorDto,
  SponsorPublic,
} from './dto/sponsor.dto';
import { InviterSponsorDto } from './dto/inviter-sponsor.dto';
import { PalierSponsor } from './entities/palier-sponsor.entity';
import { Sponsor } from './entities/sponsor.entity';
import { SponsorService } from './sponsor.service';

type Requete = Request & { user: { id: string; role: Role } };

@ApiTags('Sponsors')
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller('sponsors')
export class SponsorController {
  constructor(private readonly sponsorService: SponsorService) {}

  // ─────────────────────────────  Vitrine  ──────────────────────────────

  @Public()
  @Get('publics')
  @ApiOperation({
    summary: 'Lister les partenaires (page publique)',
    description:
      'Ni adresse email, ni quotas, ni statistiques : ces données servent la ' +
      'relation commerciale, pas l’affichage. Les exposer livrerait les ' +
      'contacts de tous les partenaires aux robots collecteurs.',
  })
  @ApiOkResponse({
    description: 'Les partenaires affichés sur la vitrine.',
    type: [SponsorPublic],
  })
  listerPublic(): Promise<SponsorPublic[]> {
    return this.sponsorService.listerPublic();
  }

  // ──────────────────────────────  Paliers  ─────────────────────────────
  // Déclarés avant « :id » : sinon « paliers » serait interprété comme un
  // identifiant, et le routeur répondrait 400 sur une route valide.

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('paliers')
  @ApiOperation({ summary: 'Lister les paliers' })
  @ApiOkResponse({
    description: 'Le catalogue des paliers.',
    type: [PalierSponsor],
  })
  listerPaliers(): Promise<PalierSponsor[]> {
    return this.sponsorService.listerPaliers();
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post('paliers')
  @ApiOperation({ summary: 'Créer un palier' })
  @ApiCreatedResponse({ description: 'Le palier créé.', type: PalierSponsor })
  creerPalier(@Body() dto: CreerPalierDto): Promise<PalierSponsor> {
    return this.sponsorService.creerPalier(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch('paliers/:id')
  @ApiOperation({ summary: 'Modifier un palier' })
  @ApiOkResponse({ description: 'Le palier mis à jour.', type: PalierSponsor })
  @ApiNotFoundResponse({
    description: 'Palier inconnu.',
    type: ReponseErreurDto,
  })
  mettreAJourPalier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourPalierDto,
  ): Promise<PalierSponsor> {
    return this.sponsorService.mettreAJourPalier(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete('paliers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprimer un palier',
    description:
      'Refusé tant qu’un partenaire s’y rattache : la relation étant en SET ' +
      'NULL, la suppression retirerait silencieusement leurs droits d’annuaire.',
  })
  @ApiNoContentResponse({ description: 'Palier supprimé.' })
  @ApiNotFoundResponse({
    description: 'Palier inconnu.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Des partenaires utilisent ce palier.',
    type: ReponseErreurDto,
  })
  supprimerPalier(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.sponsorService.supprimerPalier(id);
  }

  // ──────────────────────────  Espace partenaire  ───────────────────────

  @ApiBearerAuth()
  @Roles(Role.SPONSOR)
  @Get('moi')
  @ApiOperation({ summary: 'Consulter sa propre fiche partenaire' })
  @ApiOkResponse({
    description: 'La fiche du partenaire connecté.',
    type: Sponsor,
  })
  @ApiNotFoundResponse({
    description: 'Aucune fiche partenaire rattachée à ce compte.',
    type: ReponseErreurDto,
  })
  maFiche(@Req() requete: Requete): Promise<Sponsor> {
    return this.sponsorService.trouverParUtilisateur(requete.user.id);
  }

  @ApiBearerAuth()
  @Roles(Role.SPONSOR)
  @Patch('moi')
  @ApiOperation({
    summary: 'Modifier sa propre fiche',
    description:
      'Le palier n’est pas modifiable ici : il conditionne l’accès à ' +
      'l’annuaire, et un partenaire pourrait sinon s’accorder les droits du ' +
      'palier supérieur. L’adresse non plus — elle sert d’identifiant de ' +
      'connexion.',
  })
  @ApiOkResponse({ description: 'La fiche mise à jour.', type: Sponsor })
  @ApiNotFoundResponse({
    description: 'Aucune fiche partenaire rattachée à ce compte.',
    type: ReponseErreurDto,
  })
  async mettreAJourMaFiche(
    @Req() requete: Requete,
    @Body() dto: MettreAJourSponsorDto,
  ): Promise<Sponsor> {
    const fiche = await this.sponsorService.trouverParUtilisateur(
      requete.user.id,
    );
    return this.sponsorService.mettreAJour(fiche.id, dto, requete.user.id);
  }

  // ───────────────────────────  Administration  ─────────────────────────

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({
    summary: 'Inviter un partenaire',
    description:
      "Réservé au bureau : un sponsor ne s'inscrit jamais de lui-même. Le " +
      'compte est créé sans mot de passe, et le partenaire choisit le sien en ' +
      "suivant le lien reçu. Aucun mot de passe n'est généré ni transmis.",
  })
  @ApiCreatedResponse({
    description: 'Partenaire créé, invitation envoyée.',
    type: Sponsor,
  })
  @ApiResponse({
    status: 409,
    description: 'Un compte utilise déjà cette adresse.',
    type: ReponseErreurDto,
  })
  inviter(@Body() dto: InviterSponsorDto): Promise<Sponsor> {
    return this.sponsorService.inviter(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({ summary: 'Lister les partenaires' })
  @ApiReponsePaginee(Sponsor, 'Page de partenaires.')
  lister(@Query() filtre: FiltreSponsorDto): Promise<ResultatPagine<Sponsor>> {
    return this.sponsorService.lister(filtre);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get(':id')
  @ApiOperation({ summary: 'Consulter un partenaire' })
  @ApiOkResponse({ description: 'Le partenaire demandé.', type: Sponsor })
  @ApiNotFoundResponse({
    description: 'Partenaire inconnu.',
    type: ReponseErreurDto,
  })
  trouver(@Param('id', ParseUUIDPipe) id: string): Promise<Sponsor> {
    return this.sponsorService.trouver(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: 'Modifier un partenaire' })
  @ApiOkResponse({ description: 'Le partenaire mis à jour.', type: Sponsor })
  @ApiNotFoundResponse({
    description: 'Partenaire inconnu.',
    type: ReponseErreurDto,
  })
  mettreAJour(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourSponsorDto,
  ): Promise<Sponsor> {
    return this.sponsorService.mettreAJour(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id/palier')
  @ApiOperation({
    summary: 'Changer le palier d’un partenaire',
    description:
      'Endpoint distinct : le palier ouvre des droits sur l’annuaire.',
  })
  @ApiOkResponse({ description: 'Le partenaire mis à jour.', type: Sponsor })
  @ApiNotFoundResponse({
    description: 'Partenaire ou palier inconnu.',
    type: ReponseErreurDto,
  })
  changerPalier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangerPalierDto,
  ): Promise<Sponsor> {
    return this.sponsorService.changerPalier(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/reinviter')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Renvoyer une invitation',
    description:
      'Le lien précédent cesse aussitôt d’être utilisable : un jeton ' +
      'communiqué par erreur est ainsi révoqué en réémettant l’invitation.',
  })
  @ApiNoContentResponse({ description: 'Nouvelle invitation envoyée.' })
  @ApiNotFoundResponse({
    description: 'Partenaire inconnu.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Accès déjà activé, ou partenaire sans compte de connexion.',
    type: ReponseErreurDto,
  })
  reinviter(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.sponsorService.reinviter(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprimer un partenaire',
    description:
      'Le compte de connexion part avec la fiche : le laisser derrière ' +
      'créerait un utilisateur au rôle SPONSOR sans partenaire associé, ' +
      'capable de se connecter sans que rien n’explique pourquoi.',
  })
  @ApiNoContentResponse({ description: 'Partenaire et compte supprimés.' })
  @ApiNotFoundResponse({
    description: 'Partenaire inconnu.',
    type: ReponseErreurDto,
  })
  supprimer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.sponsorService.supprimer(id);
  }
}
