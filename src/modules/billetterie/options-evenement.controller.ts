import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Role } from '../../common/enums/role.enum';
import {
  ApiErreursAuthentification,
  ApiErreurValidation,
  ReponseErreurDto,
} from '../../common/swagger';
import { AuthOptionnelle } from '../auth/decorators/auth-optionnelle.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ModifierReponsesDto } from './dto/billetterie.dto';
import { Inscription } from './entities/inscription.entity';
import {
  OptionRecapitulee,
  OptionsConsultees,
  OptionsEvenementService,
} from './options-evenement.service';

type Requete = Request & { user?: { id: string; role: Role } };

/**
 * Les options d'un événement : consulter ce qui reste, changer son choix,
 * et — pour le bureau — compter, exporter, relancer.
 */
@ApiTags('Billetterie')
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller()
export class OptionsEvenementController {
  constructor(private readonly options: OptionsEvenementService) {}

  @AuthOptionnelle()
  @Get('evenements/:id/options')
  @ApiOperation({
    summary: 'Les choix demandés à l’inscription, avec ce qu’il en reste',
    description:
      'Ouvert à tous : le formulaire d’inscription en a besoin pour griser ' +
      'les valeurs épuisées. Donne aussi la date où les choix se figent.',
  })
  @ApiOkResponse({ description: 'Options, stock restant, date de figeage.' })
  consulter(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<OptionsConsultees> {
    return this.options.consulter(id, requete.user);
  }

  @ApiBearerAuth()
  @Patch('billets/:id/reponses')
  @ApiOperation({
    summary: 'Changer son choix (taille de T-shirt…)',
    description:
      'Tant que les choix ne sont pas figés, et que le lot n’a pas été remis. ' +
      'Refusé si la nouvelle valeur est épuisée.',
  })
  @ApiOkResponse({ type: Inscription })
  @ApiResponse({
    status: 409,
    description: 'Choix figés, lot déjà remis, ou valeur épuisée.',
    type: ReponseErreurDto,
  })
  modifier(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModifierReponsesDto,
    @Req() requete: Requete,
  ): Promise<Inscription> {
    return this.options.modifierReponses(id, requete.user!.id, dto.reponses);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('evenements/:id/options/recapitulatif')
  @ApiOperation({
    summary: 'Combien de chaque choix',
    description:
      'Par valeur : inscrits payés, en attente, stock et reste ; et ceux qui ' +
      'n’ont pas répondu. C’est le chiffre à porter au fournisseur.',
  })
  @ApiOkResponse({ description: 'Récapitulatif par option.' })
  recapitulatif(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OptionRecapitulee[]> {
    return this.options.recapitulatif(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Get('evenements/:id/options/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="inscrits-options.csv"')
  @ApiOperation({
    summary: 'Exporter les inscrits et leurs choix en CSV',
    description: 'Nom par nom, pour la commande et la distribution.',
  })
  @ApiOkResponse({ description: 'Le fichier CSV.' })
  exporter(@Param('id', ParseUUIDPipe) id: string): Promise<string> {
    return this.options.exporterCsv(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post('evenements/:id/options/relancer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Relancer ceux qui n’ont pas fait leur choix',
    description:
      'Une notification à chaque inscrit (non annulé) à qui il manque une ' +
      'réponse obligatoire — utile quand les options sont ajoutées après les ' +
      'premières inscriptions.',
  })
  @ApiOkResponse({ description: 'Nombre de personnes prévenues.' })
  async relancer(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ prevenus: number }> {
    return { prevenus: await this.options.relancer(id) };
  }
}
