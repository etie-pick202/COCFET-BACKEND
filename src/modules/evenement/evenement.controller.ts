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
  ApiExtraModels,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
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
import { User } from '../user/entities/user.entity';
import { UserService } from '../user/user.service';
import {
  CreerEvenementDto,
  EvenementAvecTarif,
  FiltreEvenementDto,
  MettreAJourEvenementDto,
} from './dto/evenement.dto';
import { Evenement } from './entities/evenement.entity';
import { EvenementService } from './evenement.service';

/** La stratégie JWT pose l'utilisateur ; il est absent sur une route optionnelle. */
type Requete = Request & { user?: { id: string; role: Role } };

@ApiTags('Événements')
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller('evenements')
export class EvenementController {
  constructor(
    private readonly evenementService: EvenementService,
    private readonly userService: UserService,
  ) {}

  @AuthOptionnelle()
  @Get()
  @ApiOperation({
    summary: 'Lister les événements',
    description:
      'Ouvert à tous. Un visiteur non connecté ne voit que les événements ' +
      'publiés ; seul un administrateur peut demander les brouillons et les ' +
      'archives.',
  })
  @ApiReponsePaginee(Evenement, 'Page d’événements.')
  lister(
    @Query() filtre: FiltreEvenementDto,
    @Req() requete: Requete,
  ): Promise<ResultatPagine<Evenement>> {
    return this.evenementService.lister(filtre, requete.user);
  }

  @AuthOptionnelle()
  @Get(':id')
  @ApiOperation({
    summary: 'Consulter un événement',
    description:
      'Le tarif renvoyé est celui applicable au demandeur. Il ne découle pas ' +
      'du rôle mais de la promotion : un ancien reste STUDENT et paie ' +
      'pourtant le tarif externe.',
  })
  @ApiExtraModels(Evenement, EvenementAvecTarif)
  @ApiOkResponse({
    description: 'L’événement, augmenté du tarif calculé pour le demandeur.',
    schema: {
      allOf: [
        { $ref: getSchemaPath(Evenement) },
        { $ref: getSchemaPath(EvenementAvecTarif) },
      ],
    },
  })
  @ApiNotFoundResponse({
    description: 'Événement inexistant ou non publié.',
    type: ReponseErreurDto,
  })
  async consulter(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<Evenement & EvenementAvecTarif> {
    const evenement = await this.evenementService.trouver(id, requete.user);
    const user = await this.utilisateurCourant(requete);

    return {
      ...evenement,
      ...(await this.evenementService.detailPour(evenement, user)),
    };
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({
    summary: 'Créer un événement',
    description:
      'Créé en brouillon : rien n’est visible ni notifié avant publication.',
  })
  @ApiCreatedResponse({ description: 'L’événement créé.', type: Evenement })
  creer(@Body() dto: CreerEvenementDto): Promise<Evenement> {
    return this.evenementService.creer(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id')
  @ApiOperation({ summary: 'Modifier un événement' })
  @ApiOkResponse({ description: 'L’événement mis à jour.', type: Evenement })
  @ApiResponse({
    status: 400,
    description: 'Capacité réduite en dessous du nombre d’inscrits.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Événement inconnu.',
    type: ReponseErreurDto,
  })
  mettreAJour(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourEvenementDto,
  ): Promise<Evenement> {
    return this.evenementService.mettreAJour(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/publier')
  @ApiOperation({
    summary: 'Publier un événement',
    description:
      'Rend l’événement visible et notifie la plateforme. Republier un ' +
      'événement déjà publié ne renotifie personne : une correction de faute ' +
      'de frappe ne doit pas alerter toute la promotion.',
  })
  @ApiOkResponse({ description: 'L’événement publié.', type: Evenement })
  @ApiNotFoundResponse({
    description: 'Événement inconnu.',
    type: ReponseErreurDto,
  })
  publier(@Param('id', ParseUUIDPipe) id: string): Promise<Evenement> {
    return this.evenementService.publier(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post(':id/archiver')
  @ApiOperation({ summary: 'Archiver un événement' })
  @ApiOkResponse({ description: 'L’événement archivé.', type: Evenement })
  @ApiNotFoundResponse({
    description: 'Événement inconnu.',
    type: ReponseErreurDto,
  })
  archiver(@Param('id', ParseUUIDPipe) id: string): Promise<Evenement> {
    return this.evenementService.archiver(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprimer un événement',
    description:
      'Refusé dès qu’une inscription existe : la suppression emporterait les ' +
      'billets, y compris payés. L’archivage est la sortie prévue.',
  })
  @ApiNoContentResponse({ description: 'Événement supprimé.' })
  @ApiResponse({
    status: 403,
    description: 'L’événement compte des inscrits.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Événement inconnu.',
    type: ReponseErreurDto,
  })
  supprimer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.evenementService.supprimer(id);
  }

  /**
   * Recharge l'utilisateur complet : le jeton ne porte que l'identifiant,
   * l'email et le rôle, alors que le tarif dépend de la promotion.
   */
  private async utilisateurCourant(
    requete: Requete,
  ): Promise<User | undefined> {
    if (!requete.user) {
      return undefined;
    }
    return (await this.userService.findById(requete.user.id)) ?? undefined;
  }
}
