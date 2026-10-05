import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';
import { PaginationDto } from '../../common/pagination';
import {
  ApiErreursAuthentification,
  ApiErreurValidation,
  ReponseErreurDto,
} from '../../common/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExigePrivilege } from '../bureau/decorators/privilege.decorator';
import { PrivilegeGuard } from '../bureau/guards/privilege.guard';
import { Privilege } from '../bureau/privileges';
import { ReleveSolde } from '../paiement/entities/releve-solde.entity';
import { Retrait } from '../paiement/entities/retrait.entity';
import { EtatSolde, NoteRetraitDto } from './dto/solde.dto';
import { SoldeService } from './solde.service';

/**
 * Solde réel et retraits, derrière le privilège de trésorerie.
 *
 * Lecture seule vis-à-vis du prestataire : aucune route ne déplace d'argent.
 * Les retraits se font dans l'espace de Fapshi et se relisent ici.
 */
@ApiTags('Trésorerie')
@ApiBearerAuth()
@ApiErreursAuthentification()
@ApiErreurValidation()
@Roles(Role.ADMIN)
@UseGuards(PrivilegeGuard)
@ExigePrivilege(Privilege.TRESORERIE)
@Controller('tableau-de-bord/tresorerie')
export class SoldeController {
  constructor(private readonly solde: SoldeService) {}

  @Get('solde')
  @ApiOperation({
    summary: 'Solde réel et écart avec nos encaissements',
    description:
      'Relit le solde chez Fapshi quand la dernière lecture a plus de cinq ' +
      'minutes. Si Fapshi ne répond pas, rend la dernière valeur connue, ' +
      'marquée `obsolete`.',
  })
  @ApiOkResponse({ type: EtatSolde })
  @ApiForbiddenResponse({
    description: 'Poste sans accès à la trésorerie.',
    type: ReponseErreurDto,
  })
  etat(): Promise<EtatSolde> {
    return this.solde.etat();
  }

  @Post('solde/synchroniser')
  @ApiOperation({
    summary: 'Relire le solde et les retraits maintenant',
    description:
      'Force la lecture chez Fapshi. Les appels simultanés partagent la ' +
      'même lecture : cliquer plusieurs fois ne multiplie pas les requêtes.',
  })
  @ApiOkResponse({ type: EtatSolde })
  async synchroniser(): Promise<EtatSolde> {
    await this.solde.synchroniser();
    return this.solde.etat();
  }

  @Get('solde/historique')
  @ApiOperation({
    summary: 'Historique du solde',
    description:
      'Photographies du solde, de la plus récente à la plus ancienne : une ' +
      'ligne à chaque changement, et au moins une par jour.',
  })
  @ApiOkResponse({ type: [ReleveSolde] })
  historique(@Query('limite') limite?: string): Promise<ReleveSolde[]> {
    return this.solde.historique(Number(limite) || 60);
  }

  @Get('retraits')
  @ApiOperation({
    summary: 'Journal des retraits',
    description:
      'Les sorties d’argent relevées chez Fapshi, de la plus récente à la ' +
      'plus ancienne, avec le motif saisi par le bureau.',
  })
  @ApiOkResponse({ description: 'Page de retraits.' })
  retraits(@Query() pagination: PaginationDto) {
    return this.solde.lister(pagination);
  }

  @Patch('retraits/:id')
  @ApiOperation({
    summary: 'Consigner le motif d’un retrait',
    description:
      'Seule la note est modifiable : montant, date et statut viennent de ' +
      'Fapshi.',
  })
  @ApiOkResponse({ type: Retrait })
  async annoter(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NoteRetraitDto,
  ): Promise<Retrait> {
    const retrait = await this.solde.annoter(id, dto.note ?? null);
    if (!retrait) {
      throw new NotFoundException('Retrait introuvable.');
    }
    return retrait;
  }
}
