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
  AffecterScannerDto,
  CodeBillet,
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

  @Get('billets/:id/qr')
  @ApiOperation({
    summary: 'Obtenir le code à présenter à l’entrée',
    description:
      'La forme dépend du régime de l’événement. Sur `QR_FIXE`, c’est le ' +
      'même code que celui reçu par email. Sur `QR_TOURNANT`, le code ne vaut ' +
      'que trente secondes : `expireDans` dit quand le redemander, et ' +
      'l’image ne doit être ni mise en cache ni enregistrée. Sur `AUCUN`, ' +
      'il n’y a rien à présenter et la route refuse.',
  })
  @ApiOkResponse({ description: 'Le code du moment.', type: CodeBillet })
  @ApiNotFoundResponse({
    description: 'Billet inconnu, ou appartenant à un autre compte.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description:
      'Billet annulé, pas encore payé, ou événement sans contrôle d’entrée.',
    type: ReponseErreurDto,
  })
  codeDuBillet(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<CodeBillet> {
    return this.billetterieService.qrDuBillet(id, requete.user.id);
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
  @Post('evenements/:id/scanners')
  @ApiOperation({
    summary: 'Placer quelqu’un au contrôle de cet événement',
    description:
      'Le portier valide les billets **de cet événement seulement**, sans rien ' +
      'administrer. L’affectation cesse de valoir d’elle-même une fois la ' +
      'fenêtre de validation refermée : aucune date n’est stockée, elle se ' +
      'déduit de l’événement, qui peut encore être décalé.',
  })
  @ApiCreatedResponse({ description: 'Le portier affecté.' })
  affecterScanner(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AffecterScannerDto,
    @Req() requete: Requete,
  ) {
    return this.billetterieService.affecterScanner(
      id,
      dto.userId,
      requete.user.id,
    );
  }

  @Roles(Role.ADMIN)
  @Get('evenements/:id/scanners')
  @ApiOperation({ summary: 'Qui tient la porte de cet événement' })
  @ApiOkResponse({ description: 'Les portiers affectés.' })
  listerScanners(@Param('id', ParseUUIDPipe) id: string) {
    return this.billetterieService.listerScanners(id);
  }

  @Roles(Role.ADMIN)
  @Delete('evenements/:id/scanners/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Retirer quelqu’un du contrôle' })
  @ApiNoContentResponse({ description: 'Portier retiré.' })
  retirerScanner(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    return this.billetterieService.retirerScanner(id, userId);
  }

  // Plus reserve a l'administration : un portier affecte a l'evenement valide
  // sans rien administrer. Le controle du rattachement se fait dans le
  // service, qui seul connait l'evenement du billet presente.
  @Post('billets/scanner')
  @ApiOperation({
    summary: 'Valider un billet à l’entrée',
    description:
      'Ouvert au bureau et aux portiers **affectés à cet événement**. Le ' +
      'passage à « utilisé » est conditionné au statut courant dans la ' +
      'requête : deux scans simultanés du même code ne peuvent pas réussir ' +
      'tous les deux. La validation n’ouvre que deux heures avant le début et ' +
      'se referme le lendemain à 10 h.',
  })
  @ApiOkResponse({ description: 'Le billet validé.', type: Inscription })
  @ApiResponse({
    status: 403,
    description: 'Vous n’êtes pas affecté au contrôle de cet événement.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description:
      'Billet déjà scanné, annulé ou impayé, ou fenêtre de validation fermée.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({ description: 'Code inconnu.', type: ReponseErreurDto })
  scanner(
    @Body() dto: ScannerBilletDto,
    @Req() requete: Requete,
  ): Promise<Inscription> {
    return this.billetterieService.scanner(dto.codeBillet, requete.user);
  }
}
