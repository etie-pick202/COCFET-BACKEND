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
import { Roles } from '../auth/decorators/roles.decorator';
import { UserService } from '../user/user.service';
import { CommandeService } from './commande.service';
import {
  CreerCommandeDto,
  FiltreCommandeDto,
  MarquerPreteDto,
} from './dto/commande.dto';
import { Commande } from './entities/commande.entity';

type Requete = Request & { user: { id: string; role: Role } };

@ApiTags('Commandes')
@ApiBearerAuth()
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller('commandes')
export class CommandeController {
  constructor(
    private readonly commandeService: CommandeService,
    private readonly userService: UserService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Passer une commande',
    description:
      'Le total est calculé côté serveur à partir du tarif applicable au ' +
      'demandeur : accepter un montant envoyé par le client reviendrait à le ' +
      'laisser fixer son prix. Le stock est réservé article par article et de ' +
      'façon atomique **avant** le paiement — sinon deux personnes pourraient ' +
      'payer le dernier exemplaire, et il faudrait rembourser.',
  })
  @ApiCreatedResponse({
    description: 'La commande créée, en attente de paiement.',
    type: Commande,
  })
  @ApiResponse({
    status: 400,
    description:
      'Panier vide, déclinaison inconnue, ou paiement refusé par l’opérateur.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Article indisponible ou stock insuffisant.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Produit inconnu, ou compte supprimé.',
    type: ReponseErreurDto,
  })
  async creer(
    @Body() dto: CreerCommandeDto,
    @Req() requete: Requete,
  ): Promise<Commande> {
    // L'utilisateur complet est rechargé : le jeton ne porte pas la promotion,
    // dont dépend pourtant le tarif.
    const user = await this.userService.trouverOuEchouer(requete.user.id);

    return this.commandeService.creer(user, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Lister ses commandes',
    description:
      "L'identifiant vient du jeton, jamais d'un paramètre : personne ne peut " +
      'lire les commandes de quelqu’un d’autre.',
  })
  @ApiReponsePaginee(Commande, 'Page de commandes du porteur du jeton.')
  mesCommandes(
    @Query() filtre: FiltreCommandeDto,
    @Req() requete: Requete,
  ): Promise<ResultatPagine<Commande>> {
    return this.commandeService.mesCommandes(requete.user.id, filtre);
  }

  @Roles(Role.ADMIN)
  @Get('toutes')
  @ApiOperation({ summary: 'Lister toutes les commandes' })
  @ApiReponsePaginee(Commande, 'Page de commandes, tous comptes confondus.')
  lister(
    @Query() filtre: FiltreCommandeDto,
  ): Promise<ResultatPagine<Commande>> {
    return this.commandeService.lister(filtre);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Consulter une commande',
    description:
      'Le propriétaire fait partie de la condition de recherche : connaître ' +
      'un identifiant ne suffit pas à lire la commande d’autrui.',
  })
  @ApiOkResponse({ description: 'La commande demandée.', type: Commande })
  @ApiNotFoundResponse({
    description: 'Commande inconnue, ou appartenant à un autre compte.',
    type: ReponseErreurDto,
  })
  consulter(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<Commande> {
    return this.commandeService.trouver(id, requete.user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Annuler sa commande',
    description:
      'Possible tant que la commande n’est pas préparée. Le stock est ' +
      'restitué : les articles retournent en vente. Une commande payée n’est ' +
      'pas remboursée automatiquement — le remboursement passe par le ' +
      'prestataire et relève du bureau.',
  })
  @ApiNoContentResponse({ description: 'Commande annulée.' })
  @ApiResponse({
    status: 409,
    description: 'Commande déjà prête, retirée, ou non annulable.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Commande inconnue, ou appartenant à un autre compte.',
    type: ReponseErreurDto,
  })
  annuler(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<void> {
    return this.commandeService.annuler(id, requete.user.id);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/prete')
  @ApiOperation({
    summary: 'Signaler une commande prête au retrait',
    description:
      'Uniquement depuis PAYEE : préparer une commande non réglée reviendrait ' +
      'à livrer sans encaisser. Le client est prévenu, avec le lieu et les ' +
      'horaires si vous les précisez.',
  })
  @ApiOkResponse({ description: 'La commande mise à jour.', type: Commande })
  @ApiResponse({
    status: 409,
    description: 'Transition interdite depuis le statut courant.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Commande inconnue.',
    type: ReponseErreurDto,
  })
  marquerPrete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarquerPreteDto,
  ): Promise<Commande> {
    return this.commandeService.marquerPrete(id, dto.instructions);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/retiree')
  @ApiOperation({
    summary: 'Constater le retrait',
    description:
      'Uniquement depuis PRETE, et tracé avec son auteur : sans cette trace, ' +
      'une commande marquée retirée sans l’être ne laisserait aucun moyen de ' +
      'savoir qui l’a validée.',
  })
  @ApiOkResponse({ description: 'La commande mise à jour.', type: Commande })
  @ApiResponse({
    status: 409,
    description: 'Transition interdite depuis le statut courant.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Commande inconnue.',
    type: ReponseErreurDto,
  })
  marquerRetiree(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<Commande> {
    return this.commandeService.marquerRetiree(id, requete.user.id);
  }
}
