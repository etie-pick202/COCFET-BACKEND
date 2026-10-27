import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Role } from '../../common/enums/role.enum';
import { LimiteDebit } from '../../common/guards/limite-debit.decorator';
import { ResultatPagine } from '../../common/pagination';
import { ApiErreurValidation, ReponseErreurDto } from '../../common/swagger';
import { AuthOptionnelle } from '../auth/decorators/auth-optionnelle.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ExigePrivilege } from '../bureau/decorators/privilege.decorator';
import { PrivilegeGuard } from '../bureau/guards/privilege.guard';
import { Privilege } from '../bureau/privileges';
import { CreerDonDto, FiltreDonDto } from './dto/don.dto';
import { Don } from './entities/don.entity';
import { DonLance, DonService, ResumeDons, SuiviDon } from './don.service';

type Requete = Request & { user?: { id: string } };

/**
 * Lancer un don est ouvert à tous : un particulier, une entreprise, quelqu'un
 * sans compte. Dix par heure et par adresse, de quoi donner plusieurs fois mais
 * pas de quoi saturer le prestataire de paiement avec des demandes factices.
 */
const LIMITE_DONS = { requetes: 10, fenetreSecondes: 3600 };

@ApiTags('Dons')
@Controller('dons')
export class DonController {
  constructor(private readonly donService: DonService) {}

  @AuthOptionnelle()
  @LimiteDebit(LIMITE_DONS)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Faire un don',
    description:
      'Ouvert à tous. La destination est toujours demandée : le comité en ' +
      'général, ou un événement. Un don anonyme ne conserve aucune identité, ' +
      'même pour une personne connectée.',
  })
  @ApiCreatedResponse({ description: 'Don lancé ; le paiement est demandé.' })
  @ApiErreurValidation()
  creer(@Body() dto: CreerDonDto, @Req() requete: Requete): Promise<DonLance> {
    return this.donService.creer(dto, requete.user ?? null);
  }

  @AuthOptionnelle()
  @Get('suivi/:reference')
  @ApiOperation({
    summary: 'Où en est un don',
    description:
      'Pour la page de remerciement. Il suffit de connaître la référence, ' +
      'aléatoire ; seul l’état du don est rendu.',
  })
  @ApiOkResponse({ description: 'L’état du don.' })
  @ApiNotFoundResponse({ type: ReponseErreurDto })
  suivre(@Param('reference') reference: string): Promise<SuiviDon> {
    return this.donService.suivre(reference);
  }
}

@ApiTags('Dons')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@UseGuards(PrivilegeGuard)
@Controller('dons')
export class DonBureauController {
  constructor(private readonly donService: DonService) {}

  @Get()
  @ExigePrivilege(Privilege.TRESORERIE)
  @ApiOperation({
    summary: 'Les dons reçus',
    description: 'Réservé aux postes ayant la trésorerie en charge.',
  })
  @ApiOkResponse({ description: 'Une page de dons.' })
  @ApiForbiddenResponse({ type: ReponseErreurDto })
  lister(@Query() filtre: FiltreDonDto): Promise<ResultatPagine<Don>> {
    return this.donService.lister(filtre);
  }

  @Get('resume')
  @ExigePrivilege(Privilege.TRESORERIE)
  @ApiOperation({ summary: 'Total des dons, au comité et par événement' })
  @ApiOkResponse({ description: 'Le résumé.' })
  resume(): Promise<ResumeDons> {
    return this.donService.resume();
  }

  @Get('export')
  @ExigePrivilege(Privilege.TRESORERIE)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="dons.csv"')
  @ApiOperation({ summary: 'Exporter les dons en CSV' })
  @ApiOkResponse({ description: 'Le fichier CSV.' })
  exporter(@Query() filtre: FiltreDonDto): Promise<string> {
    return this.donService.exporterCsv(filtre);
  }
}
