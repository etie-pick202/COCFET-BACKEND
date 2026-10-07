import {
  Body,
  Controller,
  Get,
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
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Role } from '../../common/enums/role.enum';
import { PaginationDto, ResultatPagine } from '../../common/pagination';
import {
  ApiErreursAuthentification,
  ApiErreurValidation,
  ReponseErreurDto,
} from '../../common/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExigePrivilege } from '../bureau/decorators/privilege.decorator';
import { PrivilegeGuard } from '../bureau/guards/privilege.guard';
import { Privilege } from '../bureau/privileges';
import { Retrait } from '../paiement/entities/retrait.entity';
import {
  AttribuerRetraitDto,
  DeclarerMouvementDto,
  ResultatMouvement,
  SuiviFonds,
} from './dto/fonds.dto';
import { MouvementFonds } from './entities/mouvement-fonds.entity';
import { FondsService } from './fonds.service';

type RequeteAuthentifiee = Request & { user: { id: string } };

/**
 * Suivi des fonds : où est l'argent du bureau, derrière le privilège de
 * trésorerie. Le compte Fapshi d'un côté, la poche de chaque membre de
 * l'autre.
 */
@ApiTags('Trésorerie')
@ApiBearerAuth()
@ApiErreursAuthentification()
@ApiErreurValidation()
@Roles(Role.ADMIN)
@UseGuards(PrivilegeGuard)
@ExigePrivilege(Privilege.TRESORERIE)
@ApiForbiddenResponse({
  description: 'Poste sans accès à la trésorerie.',
  type: ReponseErreurDto,
})
@Controller('fonds')
export class FondsController {
  constructor(private readonly fonds: FondsService) {}

  @Get('suivi')
  @ApiOperation({
    summary: 'Où est l’argent',
    description:
      'Le solde Fapshi, ce que chaque membre détient, l’argent retiré dont ' +
      'on ne connaît pas encore le détenteur, et les anomalies à regarder.',
  })
  @ApiOkResponse({ type: SuiviFonds })
  suivi(): Promise<SuiviFonds> {
    return this.fonds.suivi();
  }

  @Get('mouvements')
  @ApiOperation({ summary: 'Journal des remises, de la plus récente' })
  @ApiOkResponse({ description: 'Page de mouvements.' })
  lister(
    @Query() pagination: PaginationDto,
  ): Promise<ResultatPagine<MouvementFonds>> {
    return this.fonds.lister(pagination);
  }

  @Post('mouvements')
  @ApiOperation({
    summary: 'Déclarer une remise',
    description:
      'Réception, transfert, remboursement, dépense — ou dépôt sur le compte ' +
      'de la plateforme, qui renvoie la page de paiement Fapshi où le régler. ' +
      'Une sortie qui dépasse ce que le membre détient est refusée.',
  })
  @ApiCreatedResponse({ type: ResultatMouvement })
  declarer(
    @Req() requete: RequeteAuthentifiee,
    @Body() dto: DeclarerMouvementDto,
  ): Promise<ResultatMouvement> {
    return this.fonds.declarer(requete.user, dto);
  }

  @Post('mouvements/:id/abandonner')
  @ApiOperation({
    summary: 'Abandonner un dépôt en attente',
    description: 'Libère l’argent réservé par un dépôt jamais réglé.',
  })
  @ApiOkResponse({ type: MouvementFonds })
  abandonner(@Param('id', ParseUUIDPipe) id: string): Promise<MouvementFonds> {
    return this.fonds.abandonnerDepot(id);
  }

  @Patch('retraits/:id')
  @ApiOperation({
    summary: 'Dire entre les mains de qui un retrait a atterri',
    description:
      'Un retrait sort l’argent de Fapshi et le met dans la poche de ' +
      'quelqu’un. Tant qu’on ne le dit pas, il reste « non attribué ».',
  })
  @ApiOkResponse({ type: Retrait })
  attribuer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttribuerRetraitDto,
  ): Promise<Retrait> {
    return this.fonds.attribuerRetrait(id, dto.detenteurId);
  }
}
