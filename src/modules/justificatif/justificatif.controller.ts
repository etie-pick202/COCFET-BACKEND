import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ApiErreursAuthentification,
  ApiErreurValidation,
  ReponseErreurDto,
} from '../../common/swagger';
import { ExigePrivilege } from '../bureau/decorators/privilege.decorator';
import { PrivilegeGuard } from '../bureau/guards/privilege.guard';
import { Privilege } from '../bureau/privileges';
import {
  FiltreJustificatifDto,
  RefuserJustificatifDto,
  ValiderJustificatifDto,
  SoumettreJustificatifDto,
} from './dto/justificatif.dto';
import { JustificatifPaiement } from './entities/justificatif-paiement.entity';
import { JustificatifService } from './justificatif.service';

type Requete = Request & { user: { id: string } };

/**
 * Preuves de paiement remises hors de la plateforme.
 *
 * Le dépôt est ouvert au payeur ; **la décision est réservée à qui accède aux
 * finances**. C'est toute la logique de ce module : une capture d'écran se
 * fabrique en deux minutes, et seule une validation humaine par quelqu'un
 * d'habilité la transforme en paiement reconnu.
 */
@ApiTags('Justificatifs de paiement')
@ApiErreursAuthentification()
@ApiErreurValidation()
@ApiBearerAuth()
@UseGuards(PrivilegeGuard)
@Controller('justificatifs')
export class JustificatifController {
  constructor(private readonly service: JustificatifService) {}

  @Post()
  @ApiOperation({
    summary: 'Déposer une preuve de paiement',
    description:
      'Réservé au titulaire du règlement, et seulement tant que celui-ci est ' +
      'en attente. Une seule preuve peut attendre une décision à la fois : ' +
      'sans cette limite, on peut noyer la trésorerie sous les captures d’un ' +
      'même règlement jusqu’à ce qu’elle en valide une sans regarder.',
  })
  @ApiCreatedResponse({
    description: 'La preuve déposée, en attente de décision.',
    type: JustificatifPaiement,
  })
  @ApiNotFoundResponse({
    description: 'Aucun règlement ne porte cette référence.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Règlement déjà tranché, ou preuve déjà en attente.',
    type: ReponseErreurDto,
  })
  soumettre(
    @Body() dto: SoumettreJustificatifDto,
    @Req() requete: Requete,
  ): Promise<JustificatifPaiement> {
    return this.service.soumettre(requete.user, dto);
  }

  @Get('moi')
  @ApiOperation({ summary: 'Mes preuves de paiement' })
  @ApiOkResponse({ type: [JustificatifPaiement] })
  lesSiennes(@Req() requete: Requete): Promise<JustificatifPaiement[]> {
    return this.service.lesSiens(requete.user.id);
  }

  @ExigePrivilege(Privilege.TRESORERIE)
  @Get()
  @ApiOperation({
    summary: 'Historique des preuves de paiement',
    description:
      'Chaque pièce est rendue avec son titulaire et, si elle a été tranchée, ' +
      'avec la personne qui a décidé. Réservé à qui accède aux finances.',
  })
  @ApiOkResponse({ type: [JustificatifPaiement] })
  lister(
    @Query() filtre: FiltreJustificatifDto,
  ): Promise<JustificatifPaiement[]> {
    return this.service.lister(filtre);
  }

  @ExigePrivilege(Privilege.TRESORERIE)
  @Post(':id/valider')
  @ApiOperation({
    summary: 'Reconnaître le paiement',
    description:
      'Produit **exactement** les mêmes effets qu’une notification du ' +
      'prestataire : la commande passe payée, le billet est émis. Un paiement ' +
      'reconnu à la main ne doit pas délivrer moins qu’un paiement en ligne.',
  })
  @ApiOkResponse({ type: JustificatifPaiement })
  @ApiResponse({
    status: 400,
    description: 'Cette preuve a déjà été tranchée.',
    type: ReponseErreurDto,
  })
  valider(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
    @Body() dto: ValiderJustificatifDto,
  ): Promise<JustificatifPaiement> {
    return this.service.valider(id, requete.user, dto);
  }

  @ExigePrivilege(Privilege.TRESORERIE)
  @Post(':id/refuser')
  @ApiOperation({
    summary: 'Refuser la preuve',
    description:
      'Le règlement **reste en attente** : un refus dit que cette image ne ' +
      'prouve rien, pas que l’argent n’a pas été versé. La personne peut en ' +
      'déposer une autre, et le motif lui dit quoi corriger.',
  })
  @ApiOkResponse({ type: JustificatifPaiement })
  refuser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefuserJustificatifDto,
    @Req() requete: Requete,
  ): Promise<JustificatifPaiement> {
    return this.service.refuser(id, requete.user, dto.motif);
  }
}
