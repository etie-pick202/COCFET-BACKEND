import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExtraModels,
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
import { BoutiqueService } from './boutique.service';
import {
  AjusterStockDto,
  CreerProduitDto,
  FiltreProduitDto,
  DefinirDeclinaisonsDto,
  MettreAJourProduitDto,
  ProduitAvecTarif,
} from './dto/boutique.dto';
import { Produit } from './entities/produit.entity';
import { DeclinaisonProduit } from './entities/declinaison-produit.entity';

/** La stratégie JWT pose l'utilisateur ; il est absent sur une route optionnelle. */
type Requete = Request & { user?: { id: string; role: Role } };

@ApiTags('Boutique')
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller('produits')
export class BoutiqueController {
  constructor(
    private readonly boutiqueService: BoutiqueService,
    private readonly userService: UserService,
  ) {}

  @AuthOptionnelle()
  @Get()
  @ApiOperation({
    summary: 'Lister le catalogue',
    description:
      'Ouvert à tous. Un visiteur ne voit jamais les articles retirés, et ' +
      'demander explicitement ce statut ne contourne pas la règle : seul un ' +
      'administrateur peut le filtrer.',
  })
  @ApiReponsePaginee(Produit, 'Page de produits.')
  lister(
    @Query() filtre: FiltreProduitDto,
    @Req() requete: Requete,
  ): Promise<ResultatPagine<Produit>> {
    return this.boutiqueService.lister(filtre, requete.user);
  }

  @AuthOptionnelle()
  @Get(':id')
  @ApiOperation({
    summary: 'Consulter un produit',
    description:
      'Le tarif renvoyé est celui applicable au demandeur. Il ne découle pas ' +
      'du rôle mais de la promotion : un ancien reste STUDENT et paie ' +
      'pourtant le tarif externe.',
  })
  @ApiExtraModels(Produit, ProduitAvecTarif)
  @ApiOkResponse({
    description: 'Le produit, augmenté du tarif calculé pour le demandeur.',
    schema: {
      allOf: [
        { $ref: getSchemaPath(Produit) },
        { $ref: getSchemaPath(ProduitAvecTarif) },
      ],
    },
  })
  @ApiNotFoundResponse({
    description: 'Produit inexistant ou retiré.',
    type: ReponseErreurDto,
  })
  async consulter(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<Produit & ProduitAvecTarif> {
    const produit = await this.boutiqueService.trouver(id, requete.user);
    const user = await this.utilisateurCourant(requete);

    return {
      ...produit,
      ...(await this.boutiqueService.detailPour(produit, user)),
    };
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Post()
  @ApiOperation({
    summary: 'Créer un produit',
    description:
      'Créé en rupture s’il n’a pas de stock : annoncer « disponible » un ' +
      'article que personne ne peut recevoir déplacerait la déception du ' +
      'catalogue à la commande.',
  })
  @ApiCreatedResponse({ description: 'Le produit créé.', type: Produit })
  @ApiNotFoundResponse({
    description: 'Événement de rattachement inconnu.',
    type: ReponseErreurDto,
  })
  creer(@Body() dto: CreerProduitDto): Promise<Produit> {
    return this.boutiqueService.creer(dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id')
  @ApiOperation({
    summary: 'Modifier un produit',
    description:
      'Le stock ne se règle pas ici : une écriture directe écraserait ce ' +
      'qu’une commande simultanée vient de retirer.',
  })
  @ApiOkResponse({ description: 'Le produit mis à jour.', type: Produit })
  @ApiResponse({
    status: 400,
    description: 'Stock envoyé sur cette route.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Produit ou événement inconnu.',
    type: ReponseErreurDto,
  })
  mettreAJour(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourProduitDto,
  ): Promise<Produit> {
    return this.boutiqueService.mettreAJour(id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Put(':id/declinaisons')
  @ApiOperation({
    summary: 'Définir le stock par taille et couleur',
    description:
      'Un compteur unique ne dit pas ce que l’acheteur doit savoir : un sweat ' +
      'affiché « 12 en stock » peut n’avoir plus aucun M, et la déception ' +
      'passe alors du catalogue à la commande. La grille remplace l’ensemble ' +
      'des déclinaisons ; leur somme devient le stock du produit.',
  })
  @ApiOkResponse({ description: 'Le produit, stock recalculé.', type: Produit })
  @ApiResponse({
    status: 400,
    description: 'Une combinaison est saisie deux fois.',
    type: ReponseErreurDto,
  })
  definirDeclinaisons(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DefinirDeclinaisonsDto,
  ): Promise<Produit> {
    return this.boutiqueService.definirDeclinaisons(id, dto.declinaisons);
  }

  @Get(':id/declinaisons')
  @ApiOperation({
    summary: 'Stock disponible par taille et couleur',
    description:
      'Permet à l’acheteur de voir ce qui reste réellement dans sa taille, ' +
      'avant de commander.',
  })
  @ApiOkResponse({ type: [DeclinaisonProduit] })
  declinaisons(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeclinaisonProduit[]> {
    return this.boutiqueService.declinaisonsDe(id);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Patch(':id/stock')
  @ApiOperation({
    summary: 'Corriger le stock',
    description:
      'En relatif, jamais en absolu : deux réapprovisionnements simultanés ' +
      'se perdraient l’un l’autre. Le statut suit — rupture à zéro, ' +
      'disponible au réapprovisionnement — sauf sur un article retiré ou en ' +
      'précommande, dont le statut est une décision, pas une conséquence.',
  })
  @ApiOkResponse({ description: 'Le produit mis à jour.', type: Produit })
  @ApiResponse({
    status: 400,
    description: 'La correction rendrait le stock négatif.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Produit inconnu.',
    type: ReponseErreurDto,
  })
  ajusterStock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AjusterStockDto,
  ): Promise<Produit> {
    return this.boutiqueService.ajusterStock(id, dto.quantite);
  }

  @ApiBearerAuth()
  @Roles(Role.ADMIN)
  @Delete(':id')
  @ApiOperation({
    summary: 'Retirer un produit du catalogue',
    description:
      'Le produit n’est pas effacé mais passé en RETIRE : les lignes de ' +
      'commande le référencent, et le supprimer emporterait l’historique des ' +
      'achats.',
  })
  @ApiOkResponse({ description: 'Le produit retiré.', type: Produit })
  @ApiNotFoundResponse({
    description: 'Produit inconnu.',
    type: ReponseErreurDto,
  })
  retirer(@Param('id', ParseUUIDPipe) id: string): Promise<Produit> {
    return this.boutiqueService.retirer(id);
  }

  /**
   * Recharge l'utilisateur complet : le jeton ne porte que l'identifiant et le
   * rôle, alors que le tarif dépend de la promotion.
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
