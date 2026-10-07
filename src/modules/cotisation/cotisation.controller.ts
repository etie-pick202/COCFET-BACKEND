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
  UseGuards,
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
import {
  ApiErreursAuthentification,
  ApiErreurValidation,
  ReponseErreurDto,
} from '../../common/swagger';
import { ExigePrivilege } from '../bureau/decorators/privilege.decorator';
import { PrivilegeGuard } from '../bureau/guards/privilege.guard';
import { Privilege } from '../bureau/privileges';
import { CotisationService } from './cotisation.service';
import {
  CreerCotisationDto,
  ApercuFraisDto,
  MettreAJourCotisationDto,
  PayerEcheanceDto,
} from './dto/cotisation.dto';
import { FraisParMethode } from './echeances';
import { Cotisation } from './entities/cotisation.entity';
import { ReglementCotisation } from './entities/reglement-cotisation.entity';

type Requete = Request & { user: { id: string; role: Role } };

/**
 * Les cotisations, et l'encaisse de ceux qui les recueillent.
 *
 * Tout ce qui expose la situation financière d'autrui exige le privilège
 * `TRESORERIE` : une cotisation dit qui a payé et qui ne l'a pas fait, ce que
 * le reste du bureau n'a pas à connaître. Chacun, en revanche, voit son propre
 * solde.
 */
@ApiTags('Cotisations')
@ApiBearerAuth()
@ApiErreursAuthentification()
@ApiErreurValidation()
@UseGuards(PrivilegeGuard)
@Controller('cotisations')
export class CotisationController {
  constructor(private readonly cotisationService: CotisationService) {}

  @Get('moi')
  @ApiOperation({
    summary: 'Mes cotisations et mon avancement',
    description:
      'Pour chaque cotisation à laquelle je suis appelé : ce que je dois, ce ' +
      'que j’ai versé, le pourcentage, et l’état de chaque tranche.',
  })
  @ApiOkResponse({
    description:
      'Mes participations : avancement, échéances réglables et règlements.',
  })
  mesCotisations(@Req() requete: Requete) {
    return this.cotisationService.mesCotisations(requete.user.id);
  }

  @Get('participations/:participationId')
  @ApiOperation({
    summary: 'Le détail d’une de mes cotisations',
    description:
      'Avancement, échéances réglables et règlements — dont chacun, une fois ' +
      'abouti, donne droit à sa facture. C’est la page où mènent les emails.',
  })
  @ApiOkResponse({ description: 'La participation, avec son avancement.' })
  @ApiNotFoundResponse({
    description: 'Participation inconnue, ou d’un autre compte.',
    type: ReponseErreurDto,
  })
  maCotisation(
    @Req() requete: Requete,
    @Param('participationId', ParseUUIDPipe) participationId: string,
  ) {
    return this.cotisationService.maCotisation(
      requete.user.id,
      participationId,
    );
  }

  @Get('frais')
  @ApiOperation({
    summary: 'Frais d’un paiement en ligne de ce montant',
    description:
      'Le montant d’un règlement est libre : les frais se recalculent donc à ' +
      'chaque saisie, avec la formule qui fixera le débit. Déclarée avant ' +
      '« :id », que « frais » serait sinon pris pour un identifiant.',
  })
  @ApiOkResponse({ type: FraisParMethode })
  frais(@Query() requete: ApercuFraisDto): FraisParMethode {
    return this.cotisationService.fraisPour(requete.montant);
  }

  @Post('participations/:participationId/payer')
  @ApiOperation({
    summary: 'Régler une échéance en ligne',
    description:
      'L’échéance est la prochaine tranche non couverte (« ordreTranche ») ou, ' +
      'sans « ordreTranche », tout le reste dû. Sur une tranche, « montant » ' +
      'est libre : on la règle à son rythme, en autant de versements que ' +
      'l’on veut, chacun crédité pour ce qu’il vaut. Le payeur est débité ' +
      'des frais du prestataire en plus du montant réglé, comme pour un ' +
      'billet ; seul le montant réglé est crédité.',
  })
  @ApiCreatedResponse({ type: ReglementCotisation })
  @ApiResponse({
    status: 409,
    description:
      'Échéance non réglable maintenant : un règlement attend déjà, ou une ' +
      'tranche antérieure reste à payer.',
    type: ReponseErreurDto,
  })
  payerEcheance(
    @Req() requete: Requete,
    @Param('participationId', ParseUUIDPipe) participationId: string,
    @Body() dto: PayerEcheanceDto,
  ): Promise<ReglementCotisation> {
    return this.cotisationService.payerEcheance(
      requete.user,
      participationId,
      dto,
    );
  }

  @Delete('reglements/:reglementId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Abandonner un paiement en ligne resté en attente',
    description:
      'Ferme la page de paiement chez le prestataire et libère les autres ' +
      'échéances. Un paiement qui aurait malgré tout abouti reste crédité.',
  })
  @ApiNoContentResponse({ description: 'Règlement abandonné.' })
  abandonnerReglement(
    @Req() requete: Requete,
    @Param('reglementId', ParseUUIDPipe) reglementId: string,
  ): Promise<void> {
    return this.cotisationService.abandonnerReglement(
      requete.user,
      reglementId,
    );
  }

  @ExigePrivilege(Privilege.TRESORERIE)
  @Get()
  @ApiOperation({ summary: 'Lister les cotisations' })
  @ApiOkResponse({ type: [Cotisation] })
  lister(): Promise<Cotisation[]> {
    return this.cotisationService.lister();
  }

  @ExigePrivilege(Privilege.TRESORERIE)
  @Get(':id')
  @ApiOperation({ summary: 'Consulter une cotisation' })
  @ApiOkResponse({ type: Cotisation })
  @ApiNotFoundResponse({
    description: 'Cotisation inconnue.',
    type: ReponseErreurDto,
  })
  trouver(@Param('id', ParseUUIDPipe) id: string): Promise<Cotisation> {
    return this.cotisationService.trouver(id);
  }

  @ExigePrivilege(Privilege.TRESORERIE)
  @Get(':id/participations')
  @ApiOperation({
    summary: 'Qui a versé quoi',
    description:
      'Réservé aux finances : la situation financière de chacun n’a pas à ' +
      'être connue du reste du bureau.',
  })
  @ApiOkResponse({ description: 'Participations, avec leur avancement.' })
  participations(@Param('id', ParseUUIDPipe) id: string) {
    return this.cotisationService.participationsDe(id);
  }

  @ExigePrivilege(Privilege.TRESORERIE)
  @Post()
  @ApiOperation({
    summary: 'Lancer une cotisation',
    description:
      'Créée en brouillon. Appeler une promotion entière à verser de l’argent ' +
      'engage le bureau : l’ouverture est un geste distinct.',
  })
  @ApiCreatedResponse({ type: Cotisation })
  @ApiResponse({
    status: 400,
    description: 'Les tranches ne totalisent pas le montant dû.',
    type: ReponseErreurDto,
  })
  creer(@Body() dto: CreerCotisationDto): Promise<Cotisation> {
    return this.cotisationService.creer(dto);
  }

  @ExigePrivilege(Privilege.TRESORERIE)
  @Patch(':id')
  @ApiOperation({ summary: 'Modifier une cotisation en brouillon' })
  @ApiOkResponse({ type: Cotisation })
  @ApiResponse({
    status: 409,
    description: 'Cotisation déjà ouverte : ses montants sont figés.',
    type: ReponseErreurDto,
  })
  mettreAJour(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourCotisationDto,
  ): Promise<Cotisation> {
    return this.cotisationService.mettreAJour(id, dto);
  }

  @ExigePrivilege(Privilege.TRESORERIE)
  @Post(':id/ouvrir')
  @ApiOperation({
    summary: 'Ouvrir la cotisation',
    description:
      'Crée une participation par personne visée et y **fige** le montant dû. ' +
      'Le calculer à la lecture rendrait tout le monde rétroactivement en ' +
      'retard à la moindre révision. Idempotent : rouvrir ne duplique rien.',
  })
  @ApiOkResponse({ type: Cotisation })
  @ApiResponse({
    status: 400,
    description: 'Aucune population visée.',
    type: ReponseErreurDto,
  })
  ouvrir(@Param('id', ParseUUIDPipe) id: string): Promise<Cotisation> {
    return this.cotisationService.ouvrir(id);
  }

  @ExigePrivilege(Privilege.TRESORERIE)
  @Post(':id/clore')
  @ApiOperation({ summary: 'Clore la cotisation' })
  @ApiOkResponse({ type: Cotisation })
  clore(@Param('id', ParseUUIDPipe) id: string): Promise<Cotisation> {
    return this.cotisationService.clore(id);
  }

  @ExigePrivilege(Privilege.TRESORERIE)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprimer une cotisation en brouillon',
    description:
      'Réservé au brouillon : effacer une cotisation ouverte emporterait les ' +
      'versements déjà reconnus, et l’argent encaissé n’aurait plus de ' +
      'contrepartie.',
  })
  @ApiNoContentResponse({ description: 'Cotisation supprimée.' })
  supprimer(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.cotisationService.supprimer(id);
  }
}
