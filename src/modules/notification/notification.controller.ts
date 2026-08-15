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
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
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
import { Roles } from '../auth/decorators/roles.decorator';
import {
  CompteNonLuesDto,
  DiffuserNotificationDto,
  FiltreNotificationDto,
  MettreAJourPreferenceDto,
  PreferenceExposee,
  ResultatDiffusionDto,
  ResultatMarquageDto,
} from './dto/notification.dto';
import { Notification } from './entities/notification.entity';
import { NotificationService } from './notification.service';
import { EMAILS_OBLIGATOIRES, EmailObligatoire } from './emails-obligatoires';

/** L'utilisateur est posé sur la requête par la stratégie JWT. */
type RequeteAuthentifiee = Request & { user: { id: string } };

@ApiTags('Notifications')
@ApiBearerAuth()
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({
    summary: 'Lister ses notifications',
    description:
      "L'identifiant vient du jeton, jamais d'un paramètre : personne ne peut " +
      'lire les notifications de quelqu’un d’autre.',
  })
  @ApiReponsePaginee(Notification, 'Page de notifications du porteur du jeton.')
  lister(
    @Req() requete: RequeteAuthentifiee,
    @Query() filtre: FiltreNotificationDto,
  ): Promise<ResultatPagine<Notification>> {
    return this.notificationService.lister(requete.user.id, filtre);
  }

  @Get('non-lues/compte')
  @ApiOperation({
    summary: 'Compter ses notifications non lues',
    description: 'Destiné à la pastille de l’interface.',
  })
  @ApiOkResponse({
    description: 'Le compte des non lues.',
    type: CompteNonLuesDto,
  })
  async compter(
    @Req() requete: RequeteAuthentifiee,
  ): Promise<{ nonLues: number }> {
    return {
      nonLues: await this.notificationService.compterNonLues(requete.user.id),
    };
  }

  @Patch(':id/lu')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Marquer une notification comme lue' })
  @ApiNoContentResponse({ description: 'Notification marquée comme lue.' })
  @ApiNotFoundResponse({
    description: 'Notification introuvable.',
    type: ReponseErreurDto,
  })
  marquerLu(
    @Req() requete: RequeteAuthentifiee,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.notificationService.marquerLu(requete.user.id, id);
  }

  @Patch('tout-lu')
  @ApiOperation({ summary: 'Tout marquer comme lu' })
  @ApiOkResponse({
    description: 'Le nombre de notifications marquées.',
    type: ResultatMarquageDto,
  })
  async marquerToutLu(
    @Req() requete: RequeteAuthentifiee,
  ): Promise<{ misAJour: number }> {
    return {
      misAJour: await this.notificationService.marquerToutLu(requete.user.id),
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Supprimer une notification' })
  @ApiNoContentResponse({ description: 'Notification supprimée.' })
  @ApiNotFoundResponse({
    description: 'Notification introuvable.',
    type: ReponseErreurDto,
  })
  supprimer(
    @Req() requete: RequeteAuthentifiee,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.notificationService.supprimer(requete.user.id, id);
  }

  @Get('preferences/obligatoires')
  @ApiOperation({
    summary: 'Emails qu’aucun réglage ne coupe',
    description:
      'Le choix laissé à chacun s’arrête là où le couper l’enfermerait ' +
      'dehors — réinitialisation de mot de passe, alerte de changement ' +
      'd’adresse — ou lui ferait perdre ce qu’il a payé, comme son billet. ' +
      'Exposé plutôt que seulement documenté : une interface qui afficherait ' +
      'un interrupteur sans effet mentirait à l’utilisateur.',
  })
  @ApiOkResponse({ type: [EmailObligatoire] })
  emailsObligatoires(): EmailObligatoire[] {
    return EMAILS_OBLIGATOIRES;
  }

  @Get('preferences')
  @ApiOperation({
    summary: 'Consulter ses préférences',
    description:
      'Tous les types sont renvoyés, y compris ceux jamais réglés : une ' +
      'préférence absente vaut « activée ».',
  })
  @ApiOkResponse({
    description: 'Un réglage par type de notification.',
    type: [PreferenceExposee],
  })
  preferences(
    @Req() requete: RequeteAuthentifiee,
  ): Promise<PreferenceExposee[]> {
    return this.notificationService.preferencesDe(requete.user.id);
  }

  @Patch('preferences')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Régler un type de notification' })
  @ApiNoContentResponse({ description: 'Préférence enregistrée.' })
  mettreAJourPreference(
    @Req() requete: RequeteAuthentifiee,
    @Body() dto: MettreAJourPreferenceDto,
  ): Promise<void> {
    return this.notificationService.mettreAJourPreference(requete.user.id, dto);
  }

  @Roles(Role.ADMIN)
  @Post('diffuser')
  @ApiOperation({
    summary: 'Diffuser une notification',
    description:
      'Réservé au bureau. Le ciblage se limite au rôle, à la promotion et au ' +
      'statut de finissant : une liste libre de destinataires ouvrirait la ' +
      'porte à des envois de masse arbitraires. Les comptes non vérifiés ou ' +
      'désactivés sont exclus.',
  })
  @ApiOkResponse({
    description: 'Le nombre de destinataires touchés.',
    type: ResultatDiffusionDto,
  })
  async diffuser(
    @Body() dto: DiffuserNotificationDto,
  ): Promise<{ destinataires: number }> {
    return { destinataires: await this.notificationService.diffuser(dto) };
  }
}
