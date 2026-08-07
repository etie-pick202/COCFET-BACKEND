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
  Put,
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
import { AnnuaireService } from './annuaire.service';
import {
  ChangerVisibiliteDto,
  MettreAJourProfilFinissantDto,
  ProfilDetail,
  ProfilResume,
  QuotasSponsor,
  RechercheAnnuaireDto,
} from './dto/annuaire.dto';
import { ProfilFinissant } from './entities/profil-finissant.entity';

type Requete = Request & { user: { id: string; role: Role } };

@ApiTags('Annuaire des finissants')
@ApiBearerAuth()
@Controller('annuaire')
export class AnnuaireController {
  constructor(private readonly annuaireService: AnnuaireService) {}

  // ────────────────────────────  Sa fiche  ──────────────────────────────
  // Déclarées avant « :id » : sinon « moi » serait pris pour un identifiant.

  @Get('moi')
  @ApiOperation({ summary: 'Consulter sa fiche' })
  monProfil(@Req() requete: Requete): Promise<ProfilFinissant> {
    return this.annuaireService.sonProfil(requete.user.id);
  }

  @Put('moi')
  @ApiOperation({
    summary: 'Créer ou mettre à jour sa fiche',
    description:
      'Réservé aux comptes dont le statut de finissant vaut vrai : l’annuaire ' +
      'est celui des finissants du mandat en cours. Ce statut est calculé à la ' +
      'bascule de génération, jamais déclaré. Remplacer une photo ou un CV ' +
      'supprime la pièce précédente.',
  })
  @ApiResponse({ status: 403, description: 'Compte non finissant.' })
  // Un seul type, jamais une union : Nest reflechit le type declare pour
  // construire la validation, et une union se reduit a `Object` — le
  // ValidationPipe laisse alors tout passer, sans le moindre message.
  enregistrer(
    @Req() requete: Requete,
    @Body() dto: MettreAJourProfilFinissantDto,
  ): Promise<ProfilFinissant> {
    return this.annuaireService.enregistrerSonProfil(requete.user.id, dto);
  }

  @Patch('moi/visibilite')
  @ApiOperation({
    summary: 'Régler sa présence dans l’annuaire',
    description:
      'Endpoint distinct, et sans équivalent côté administration : l’annuaire ' +
      'expose des données personnelles à des entreprises, et le consentement ' +
      'de la personne ne se délègue pas au bureau.',
  })
  changerVisibilite(
    @Req() requete: Requete,
    @Body() dto: ChangerVisibiliteDto,
  ): Promise<ProfilFinissant> {
    return this.annuaireService.changerVisibilite(requete.user.id, dto);
  }

  @Delete('moi')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Supprimer sa fiche',
    description: 'Les pièces déposées sont supprimées du stockage.',
  })
  supprimer(@Req() requete: Requete): Promise<void> {
    return this.annuaireService.supprimerSonProfil(requete.user.id);
  }

  @Roles(Role.SPONSOR)
  @Get('quotas')
  @ApiOperation({ summary: 'État de ses quotas d’accréditation' })
  mesQuotas(@Req() requete: Requete): Promise<QuotasSponsor> {
    return this.annuaireService.mesQuotas(requete.user.id);
  }

  // ──────────────────────────  Consultation  ────────────────────────────

  @Roles(Role.SPONSOR, Role.ADMIN)
  @Get()
  @ApiOperation({
    summary: 'Rechercher dans l’annuaire',
    description:
      'Ne consomme aucun quota : la liste ne livre ni CV, ni liens externes, ' +
      'ni biographie. Une liste complète rendrait le quota décoratif, ' +
      'puisqu’il suffirait d’en parcourir les pages. Seuls les profils ' +
      'visibles apparaissent.',
  })
  @ApiResponse({
    status: 403,
    description: 'Palier sans accès à l’annuaire, ou sans palier.',
  })
  rechercher(
    @Query() filtre: RechercheAnnuaireDto,
    @Req() requete: Requete,
  ): Promise<ResultatPagine<ProfilResume>> {
    return this.annuaireService.rechercher(filtre, requete.user);
  }

  @Roles(Role.SPONSOR, Role.ADMIN)
  @Get(':id')
  @ApiOperation({
    summary: 'Consulter une fiche complète',
    description:
      'Décompte le quota de consultations : c’est ici que la donnée ' +
      'personnelle est réellement livrée. Un administrateur consulte sans ' +
      'décompte — il ne paie pas d’accréditation.',
  })
  @ApiResponse({ status: 403, description: 'Quota de consultations épuisé.' })
  consulter(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<ProfilDetail> {
    return this.annuaireService.consulter(id, requete.user);
  }

  @Roles(Role.SPONSOR, Role.ADMIN)
  @Post(':id/cv')
  @ApiOperation({
    summary: 'Obtenir le CV d’un finissant',
    description:
      'Renvoie une URL signée qui expire en cinq minutes : un lien permanent ' +
      'circulerait bien au-delà du partenaire accrédité, et le CV est la pièce ' +
      'la plus sensible de l’annuaire. Le quota est décompté et le ' +
      'téléchargement tracé.',
  })
  @ApiResponse({ status: 403, description: 'Quota de téléchargements épuisé.' })
  telechargerCv(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: Requete,
  ): Promise<{ url: string; expireDans: number }> {
    return this.annuaireService.telechargerCv(id, requete.user);
  }

  @Roles(Role.ADMIN)
  @Post('sponsors/:id/reinitialiser-quotas')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remettre les quotas d’un partenaire à zéro',
    description: 'Nouvelle période de facturation.',
  })
  reinitialiser(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.annuaireService.reinitialiserQuotas(id);
  }
}
