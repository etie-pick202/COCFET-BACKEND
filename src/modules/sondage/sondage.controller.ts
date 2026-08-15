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
  UnauthorizedException,
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
import { Roles } from '../auth/decorators/roles.decorator';
import { UserService } from '../user/user.service';
import {
  CreerSondageDto,
  FiltreSondageDto,
  MettreAJourSondageDto,
  ResultatsSondage,
  VoterDto,
} from './dto/sondage.dto';
import { Sondage } from './entities/sondage.entity';
import { SondageService } from './sondage.service';

/** La stratégie JWT pose l'utilisateur ; il est absent sur une route optionnelle. */
type Requete = Request & { user?: { id: string; role: Role } };

@ApiTags('Sondages')
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller('sondages')
export class SondageController {
  constructor(
    private readonly sondageService: SondageService,
    private readonly userService: UserService,
  ) {}

  @AuthOptionnelle()
  @Get()
  @ApiOperation({
    summary: 'Lister les sondages',
    description:
      'Ouvert à tous. Les brouillons ne sont visibles que de ' +
      'l’administration : connaître un sondage en préparation permettrait de ' +
      'préparer sa réponse.',
  })
  @ApiReponsePaginee(Sondage, 'Page de sondages.')
  lister(
    @Query() filtre: FiltreSondageDto,
    @Req() requete: Requete,
  ): Promise<ResultatPagine<Sondage>> {
    return this.sondageService.lister(filtre, requete.user);
  }

  @AuthOptionnelle()
  @Get(':id')
  @ApiOperation({
    summary: 'Consulter un sondage',
    description:
      'Rend la question et ses options. Les décomptes, eux, passent par la ' +
      'route des résultats, qui applique la règle de visibilité.',
  })
  @ApiOkResponse({ description: 'Le sondage.', type: Sondage })
  @ApiNotFoundResponse({
    description: 'Sondage inexistant ou en préparation.',
    type: ReponseErreurDto,
  })
  consulter(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<Sondage> {
    return this.sondageService.trouver(id, requete.user);
  }

  @ApiBearerAuth()
  @Get(':id/resultats')
  @ApiOperation({
    summary: 'Consulter le dépouillement',
    description:
      'Les décomptes sont rendus nuls — et non omis — tant que la visibilité ' +
      'du sondage les masque : un champ absent se confondrait avec un score ' +
      'de zéro. `resultatsVisibles` dit lequel des deux cas s’applique.',
  })
  @ApiOkResponse({ description: 'Le dépouillement.', type: ResultatsSondage })
  @ApiNotFoundResponse({
    description: 'Sondage inexistant ou en préparation.',
    type: ReponseErreurDto,
  })
  resultats(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<ResultatsSondage> {
    return this.sondageService.resultats(id, requete.user!.id, requete.user);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get(':id/depouillement')
  @ApiOperation({
    summary: 'Dépouillement nominatif',
    description:
      'Qui a voté quoi, et la répartition des voix par promotion. Les ' +
      'pourcentages se rapportent aux **votants du segment**, non à ' +
      'l’ensemble : dire qu’une option pèse 8 % du total ne dirait rien de ce ' +
      'que pense la promotion concernée. ' +
      '**Refusé sur un sondage anonyme.** Le bulletin y est délibérément ' +
      'détaché de son auteur, et le recomposer — un segment d’une seule ' +
      'personne suffit — viderait la promesse de son sens.',
  })
  @ApiOkResponse({ description: 'Bulletins et répartition par promotion.' })
  @ApiResponse({
    status: 403,
    description: 'Sondage anonyme : le dépouillement nominatif est refusé.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Sondage inexistant.',
    type: ReponseErreurDto,
  })
  depouillement(@Param('id', ParseUUIDPipe) id: string) {
    return this.sondageService.depouillementNominatif(id);
  }

  @ApiBearerAuth()
  @Post(':id/voter')
  @ApiOperation({
    summary: 'Voter',
    description:
      'Un seul bulletin par personne, y compris sur un sondage anonyme : la ' +
      'participation est enregistrée à part du bulletin, ce qui interdit le ' +
      'double vote sans révéler le choix. Rend le dépouillement tel que le ' +
      'votant a désormais le droit de le voir.',
  })
  @ApiOkResponse({
    description: 'Vote enregistré, dépouillement à jour.',
    type: ResultatsSondage,
  })
  @ApiResponse({
    status: 400,
    description:
      'Option étrangère au sondage, ou plusieurs réponses à un ' +
      'sondage à choix unique.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Sondage réservé aux membres du campus.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Vote déjà exprimé, sondage clos, ou date limite passée.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Sondage inconnu.',
    type: ReponseErreurDto,
  })
  async voter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoterDto,
    @Req() requete: Requete,
  ): Promise<ResultatsSondage> {
    // Le compte complet est rechargé : le jeton ne porte que l'identifiant,
    // l'email et le rôle, alors que l'éligibilité dépend de la promotion.
    const votant = await this.userService.findById(requete.user!.id);

    if (!votant) {
      // Jeton valide dont le compte a disparu entre-temps : la session ne vaut
      // plus rien.
      throw new UnauthorizedException('Session expirée.');
    }

    return this.sondageService.voter(id, votant, dto.optionIds);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({
    summary: 'Créer un sondage',
    description:
      'Créé en brouillon : rien n’est visible ni notifié avant ouverture. Le ' +
      'titre, les options et le type ne sont plus modifiables ensuite — tant ' +
      'qu’aucun vote n’est exprimé, le sondage se supprime et se recrée.',
  })
  @ApiCreatedResponse({ description: 'Le sondage créé.', type: Sondage })
  creer(@Body() dto: CreerSondageDto): Promise<Sondage> {
    return this.sondageService.creer(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id')
  @ApiOperation({
    summary: 'Modifier un sondage',
    description:
      'Seuls la description, la date limite, la visibilité des résultats et ' +
      'la restriction au campus se retouchent. Changer la question ou les ' +
      'options ferait répondre les votants à ce qu’ils n’ont pas lu.',
  })
  @ApiOkResponse({ description: 'Le sondage mis à jour.', type: Sondage })
  @ApiResponse({
    status: 409,
    description: 'Sondage clos.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Sondage inconnu.',
    type: ReponseErreurDto,
  })
  mettreAJour(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourSondageDto,
  ): Promise<Sondage> {
    return this.sondageService.mettreAJour(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/activer')
  @ApiOperation({
    summary: 'Ouvrir le vote',
    description:
      'Rend le sondage visible et invite la plateforme. Un sondage réservé au ' +
      'campus n’est pas annoncé aux visiteurs. Réactiver un sondage déjà ' +
      'ouvert ne renotifie personne.',
  })
  @ApiOkResponse({ description: 'Le sondage ouvert.', type: Sondage })
  @ApiResponse({
    status: 400,
    description: 'Date limite déjà passée.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Sondage clos.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Sondage inconnu.',
    type: ReponseErreurDto,
  })
  activer(@Param('id', ParseUUIDPipe) id: string): Promise<Sondage> {
    return this.sondageService.activer(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/clore')
  @ApiOperation({
    summary: 'Clore le vote',
    description: 'Fige le dépouillement. Le sondage ne se rouvre pas.',
  })
  @ApiOkResponse({ description: 'Le sondage clos.', type: Sondage })
  @ApiNotFoundResponse({
    description: 'Sondage inconnu.',
    type: ReponseErreurDto,
  })
  clore(@Param('id', ParseUUIDPipe) id: string): Promise<Sondage> {
    return this.sondageService.clore(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprimer un sondage',
    description:
      'Refusé dès qu’un bulletin existe : la suppression emporterait des ' +
      'votes exprimés. La clôture est la sortie prévue.',
  })
  @ApiNoContentResponse({ description: 'Sondage supprimé.' })
  @ApiResponse({
    status: 403,
    description: 'Le sondage compte des votes.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Sondage inconnu.',
    type: ReponseErreurDto,
  })
  supprimer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.sondageService.supprimer(id);
  }
}
