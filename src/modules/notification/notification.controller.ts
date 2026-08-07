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
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Role } from '../../common/enums/role.enum';
import { ResultatPagine } from '../../common/pagination';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  DiffuserNotificationDto,
  FiltreNotificationDto,
  MettreAJourPreferenceDto,
} from './dto/notification.dto';
import { Notification } from './entities/notification.entity';
import { NotificationService } from './notification.service';

/** L'utilisateur est posé sur la requête par la stratégie JWT. */
type RequeteAuthentifiee = Request & { user: { id: string } };

@ApiTags('Notifications')
@ApiBearerAuth()
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
  @ApiResponse({ status: 404, description: 'Notification introuvable.' })
  marquerLu(
    @Req() requete: RequeteAuthentifiee,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.notificationService.marquerLu(requete.user.id, id);
  }

  @Patch('tout-lu')
  @ApiOperation({ summary: 'Tout marquer comme lu' })
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
  supprimer(
    @Req() requete: RequeteAuthentifiee,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.notificationService.supprimer(requete.user.id, id);
  }

  @Get('preferences')
  @ApiOperation({
    summary: 'Consulter ses préférences',
    description:
      'Tous les types sont renvoyés, y compris ceux jamais réglés : une ' +
      'préférence absente vaut « activée ».',
  })
  preferences(@Req() requete: RequeteAuthentifiee) {
    return this.notificationService.preferencesDe(requete.user.id);
  }

  @Patch('preferences')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Régler un type de notification' })
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
  async diffuser(
    @Body() dto: DiffuserNotificationDto,
  ): Promise<{ destinataires: number }> {
    return { destinataires: await this.notificationService.diffuser(dto) };
  }
}
