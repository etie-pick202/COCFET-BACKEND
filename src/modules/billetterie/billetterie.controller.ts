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
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Role } from '../../common/enums/role.enum';
import { ResultatPagine } from '../../common/pagination';
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
  @ApiResponse({
    status: 409,
    description: 'Événement complet ou déjà inscrit.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Inscriptions fermées, événement commencé, ou paiement refusé.',
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
  annuler(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<void> {
    return this.billetterieService.annuler(id, requete.user.id);
  }

  @Roles(Role.ADMIN)
  @Get('evenements/:id/inscriptions')
  @ApiOperation({ summary: 'Lister les inscrits d’un événement' })
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
  @ApiResponse({
    status: 409,
    description: 'Billet déjà scanné, annulé ou impayé.',
  })
  scanner(@Body() dto: ScannerBilletDto): Promise<Inscription> {
    return this.billetterieService.scanner(dto.codeBillet);
  }
}
