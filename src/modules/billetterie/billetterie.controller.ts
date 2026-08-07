import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
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
  ReponseMessageDto,
} from '../../common/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserService } from '../user/user.service';
import { BilletterieService } from './billetterie.service';
import {
  FiltreInscriptionDto,
  ScannerBilletDto,
  SInscrireDto,
} from './dto/billetterie.dto';
import { Inscription } from './entities/inscription.entity';

type Requete = Request & { user: { id: string; role: Role } };

@ApiTags('Billetterie')
@ApiBearerAuth()
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller()
export class BilletterieController {
  constructor(
    private readonly billetterieService: BilletterieService,
    private readonly userService: UserService,
  ) {}

  @Post('evenements/:id/inscription')
  @ApiOperation({
    summary: 'S’inscrire à un événement',
    description:
      'La place est réservée avant le paiement, par une mise à jour ' +
      'conditionnelle atomique : deux personnes ne peuvent pas payer la même ' +
      'dernière place. Si le paiement échoue, la place est rendue.',
  })
  @ApiCreatedResponse({
    description: 'Le billet émis — payé, ou en attente de paiement.',
    type: Inscription,
  })
  @ApiResponse({
    status: 409,
    description: 'Événement complet ou déjà inscrit.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 400,
    description:
      'Inscriptions fermées, événement commencé, ou paiement refusé.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Événement inconnu ou compte supprimé.',
    type: ReponseErreurDto,
  })
  async sInscrire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SInscrireDto,
    @Req() requete: Requete,
  ): Promise<Inscription> {
    // L'utilisateur complet est rechargé : le jeton ne porte pas la promotion,
    // dont dépend pourtant le tarif.
    const user = await this.userService.findById(requete.user.id);
    if (!user) {
      throw new NotFoundException("Ce compte n'existe plus.");
    }

    return this.billetterieService.sInscrire(id, user, dto);
  }

  @Get('billets')
  @ApiOperation({ summary: 'Lister ses billets' })
  @ApiReponsePaginee(Inscription, 'Page de billets du porteur du jeton.')
  mesBillets(
    @Query() filtre: FiltreInscriptionDto,
    @Req() requete: Requete,
  ): Promise<ResultatPagine<Inscription>> {
    return this.billetterieService.mesBillets(requete.user.id, filtre);
  }

  @Get('billets/:id')
  @ApiOperation({
    summary: 'Consulter un billet',
    description:
      'Le propriétaire fait partie de la condition de recherche : connaître ' +
      'un identifiant ne suffit pas à lire le billet d’autrui, ni son code ' +
      'd’entrée.',
  })
  @ApiOkResponse({ description: 'Le billet demandé.', type: Inscription })
  @ApiNotFoundResponse({
    description: 'Billet inconnu, ou appartenant à un autre compte.',
    type: ReponseErreurDto,
  })
  consulter(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<Inscription> {
    return this.billetterieService.trouverBillet(id, requete.user.id);
  }

  @Delete('billets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Annuler son inscription',
    description:
      'Impossible après le début de l’événement ou une fois le billet scanné. ' +
      'Un billet payé n’est pas remboursé automatiquement : le remboursement ' +
      'passe par le prestataire et relève du bureau.',
  })
  @ApiNoContentResponse({ description: 'Inscription annulée.' })
  @ApiResponse({
    status: 400,
    description: 'Événement commencé, ou billet déjà scanné.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Billet inconnu, ou appartenant à un autre compte.',
    type: ReponseErreurDto,
  })
  annuler(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<void> {
    return this.billetterieService.annuler(id, requete.user.id);
  }

  @Post('billets/:id/renvoyer')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Se faire renvoyer son billet par email',
    description:
      'Un email se perd ou part en indésirable. Sans ce recours, récupérer ' +
      'son billet supposerait d’annuler puis de se réinscrire — donc de ' +
      'repayer. Le QR reste identique : il dérive du code d’entrée, qui ne ' +
      'change pas.',
  })
  @ApiAcceptedResponse({
    description: 'Envoi pris en compte.',
    type: ReponseMessageDto,
  })
  @ApiNotFoundResponse({
    description: 'Billet inconnu, ou appartenant à un autre compte.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Billet annulé, ou pas encore payé.',
    type: ReponseErreurDto,
  })
  async renvoyer(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<ReponseMessageDto> {
    await this.billetterieService.renvoyerBillet(id, requete.user.id);

    return {
      message: 'Votre billet vient d’être renvoyé à l’adresse de votre compte.',
    };
  }

  @Roles(Role.ADMIN)
  @Get('evenements/:id/inscriptions')
  @ApiOperation({ summary: 'Lister les inscrits d’un événement' })
  @ApiReponsePaginee(Inscription, 'Page d’inscriptions à cet événement.')
  listerInscrits(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() filtre: FiltreInscriptionDto,
  ): Promise<ResultatPagine<Inscription>> {
    return this.billetterieService.listerPourEvenement(id, filtre);
  }

  @Roles(Role.ADMIN)
  @Post('billets/scanner')
  @ApiOperation({
    summary: 'Valider un billet à l’entrée',
    description:
      'Le passage à « utilisé » est conditionné au statut courant dans la ' +
      'requête : deux scans simultanés du même code ne peuvent pas réussir ' +
      'tous les deux.',
  })
  @ApiOkResponse({ description: 'Le billet validé.', type: Inscription })
  @ApiResponse({
    status: 409,
    description: 'Billet déjà scanné, annulé ou impayé.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({ description: 'Code inconnu.', type: ReponseErreurDto })
  scanner(@Body() dto: ScannerBilletDto): Promise<Inscription> {
    return this.billetterieService.scanner(dto.codeBillet);
  }
}
