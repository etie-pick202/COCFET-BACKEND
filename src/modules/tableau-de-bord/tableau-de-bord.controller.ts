import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Role } from '../../common/enums/role.enum';
import {
  ApiErreursAuthentification,
  ApiErreurValidation,
  ReponseErreurDto,
} from '../../common/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExigePrivilege } from '../bureau/decorators/privilege.decorator';
import { PrivilegeGuard } from '../bureau/guards/privilege.guard';
import { Privilege } from '../bureau/privileges';
import { JournalActivite } from '../activite/entities/journal-activite.entity';
import { Transaction } from '../paiement/entities/transaction.entity';
import {
  FiltreActiviteDto,
  FiltreTransactionDto,
  PeriodeDto,
  TableauGeneral,
  TableauTresorerie,
} from './dto/tableau-de-bord.dto';
import { TableauDeBordService } from './tableau-de-bord.service';
import { TresorerieService } from './tresorerie.service';

@ApiTags('Tableau de bord')
@ApiBearerAuth()
@ApiErreursAuthentification()
@ApiErreurValidation()
@Roles(Role.ADMIN)
@UseGuards(PrivilegeGuard)
@Controller('tableau-de-bord')
export class TableauDeBordController {
  constructor(
    private readonly tableauDeBordService: TableauDeBordService,
    private readonly tresorerieService: TresorerieService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Indicateurs d’activité',
    description:
      'Ouvert à tout le bureau. Aucun montant n’y figure : les chiffres ' +
      'd’argent relèvent de la trésorerie, derrière un privilège distinct.',
  })
  @ApiOkResponse({ description: 'Les indicateurs.', type: TableauGeneral })
  general(): Promise<TableauGeneral> {
    return this.tableauDeBordService.tableau();
  }

  @Get('tresorerie')
  @ExigePrivilege(Privilege.TRESORERIE)
  @ApiOperation({
    summary: 'Indicateurs financiers',
    description:
      'Réservé aux postes ayant la trésorerie en charge — le contrôle est ' +
      'appliqué côté serveur, appeler l’API directement ne le contourne pas. ' +
      'Seuls les paiements aboutis sont comptés : additionner ceux en ' +
      'attente afficherait une recette qui n’existe pas encore.',
  })
  @ApiOkResponse({ description: 'Les chiffres.', type: TableauTresorerie })
  @ApiForbiddenResponse({
    description: 'Poste sans accès à la trésorerie.',
    type: ReponseErreurDto,
  })
  tresorerie(@Query() periode: PeriodeDto): Promise<TableauTresorerie> {
    return this.tresorerieService.tableau(periode);
  }

  @Get('activite')
  @ApiOperation({
    summary: 'Flux d’activité',
    description:
      'Les faits marquants, du plus récent au plus ancien : paiements, ' +
      'entrées scannées, commandes. Ouvert à tout le bureau — ce qui y ' +
      'figure est déjà visible poste par poste.',
  })
  @ApiOkResponse({ description: 'Page du journal.' })
  activite(@Query() filtre: FiltreActiviteDto): Promise<{
    donnees: JournalActivite[];
    meta: { page: number; limite: number; total: number; totalPages: number };
  }> {
    return this.tableauDeBordService.activite(filtre);
  }

  @Get('transactions')
  @ExigePrivilege(Privilege.TRESORERIE)
  @ApiOperation({
    summary: 'Journal des transactions',
    description:
      'La pièce comptable, filtrable par origine, statut, méthode et ' +
      'période. Réservé aux postes ayant la trésorerie en charge.',
  })
  @ApiOkResponse({ description: 'Page de transactions.' })
  @ApiForbiddenResponse({
    description: 'Poste sans accès à la trésorerie.',
    type: ReponseErreurDto,
  })
  journal(@Query() filtre: FiltreTransactionDto): Promise<{
    donnees: Transaction[];
    meta: { page: number; limite: number; total: number; totalPages: number };
  }> {
    return this.tresorerieService.journal(filtre);
  }

  @Get('transactions/export')
  @ExigePrivilege(Privilege.TRESORERIE)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="transactions.csv"')
  @ApiOperation({
    summary: 'Exporter les transactions en CSV',
    description:
      'Export **non paginé** de la période demandée : un tableur tronqué à ' +
      'vingt lignes ne servirait à rien. Séparateur point-virgule et BOM ' +
      'UTF-8, ce qu’attend Excel en locale française.',
  })
  @ApiOkResponse({ description: 'Le fichier CSV.' })
  @ApiForbiddenResponse({
    description: 'Poste sans accès à la trésorerie.',
    type: ReponseErreurDto,
  })
  exporter(@Query() filtre: FiltreTransactionDto): Promise<string> {
    return this.tresorerieService.exporterCsv(filtre);
  }
}
