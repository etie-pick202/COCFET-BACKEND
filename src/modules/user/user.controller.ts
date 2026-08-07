import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Role } from '../../common/enums/role.enum';
import { MetaPagination } from '../../common/pagination';
import {
  ApiErreursAuthentification,
  ApiErreurValidation,
  ApiReponsePaginee,
  ReponseErreurDto,
} from '../../common/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  ChangerMotDePasseDto,
  exposerUtilisateur,
  FiltreUtilisateurDto,
  MettreAJourProfilDto,
  MettreAJourUtilisateurDto,
  UtilisateurExpose,
} from './dto/user.dto';
import { UserService } from './user.service';

type Requete = Request & { user: { id: string; role: Role } };

@ApiTags('Utilisateurs')
@ApiBearerAuth()
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller('utilisateurs')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // ─────────────────────────────  Son compte  ───────────────────────────
  // Déclarés avant « :id » : sinon « moi » serait interprété comme un
  // identifiant, et le routeur répondrait 400 sur une route valide.

  @Get('moi')
  @ApiOperation({
    summary: 'Consulter son profil',
    description:
      "L'identifiant vient du jeton, jamais d'un paramètre. La réponse est " +
      'construite champ par champ : ni empreinte de mot de passe, ni jeton de ' +
      'rafraîchissement ne peuvent s’y glisser.',
  })
  @ApiOkResponse({
    description: 'Le compte du porteur du jeton.',
    type: UtilisateurExpose,
  })
  async monProfil(@Req() requete: Requete): Promise<UtilisateurExpose> {
    return exposerUtilisateur(
      await this.userService.trouverOuEchouer(requete.user.id),
    );
  }

  @Patch('moi')
  @ApiOperation({
    summary: 'Modifier son profil',
    description:
      'Prénom, nom et photo seulement. Le rôle ouvrirait l’administration, la ' +
      'promotion détermine le tarif campus, et le statut de finissant décide ' +
      'de l’appartenance à l’annuaire : aucun des trois ne se déclare.',
  })
  @ApiOkResponse({
    description: 'Le compte mis à jour.',
    type: UtilisateurExpose,
  })
  async mettreAJourMonProfil(
    @Req() requete: Requete,
    @Body() dto: MettreAJourProfilDto,
  ): Promise<UtilisateurExpose> {
    return exposerUtilisateur(
      await this.userService.mettreAJourProfil(requete.user.id, dto),
    );
  }

  @Patch('moi/mot-de-passe')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Changer son mot de passe',
    description:
      'Le mot de passe actuel est exigé : sans lui, un jeton volé suffirait à ' +
      'verrouiller le compte de son propriétaire. Les autres sessions sont ' +
      'ensuite coupées.',
  })
  @ApiNoContentResponse({ description: 'Mot de passe changé.' })
  @ApiResponse({
    status: 401,
    description: 'Mot de passe actuel incorrect.',
    type: ReponseErreurDto,
  })
  changerMonMotDePasse(
    @Req() requete: Requete,
    @Body() dto: ChangerMotDePasseDto,
  ): Promise<void> {
    return this.userService.changerMotDePasse(requete.user.id, dto);
  }

  // ───────────────────────────  Administration  ─────────────────────────

  @Roles(Role.ADMIN)
  @Get()
  @ApiOperation({
    summary: 'Lister les comptes',
    description:
      'Filtres sur le rôle, la promotion, le statut de finissant et l’activité, ' +
      'plus une recherche sur le nom et l’adresse.',
  })
  @ApiReponsePaginee(UtilisateurExpose, 'Page de comptes.')
  async lister(
    @Query() filtre: FiltreUtilisateurDto,
  ): Promise<{ donnees: UtilisateurExpose[]; meta: MetaPagination }> {
    const resultat = await this.userService.lister(filtre);

    return {
      donnees: resultat.donnees.map(exposerUtilisateur),
      meta: resultat.meta,
    };
  }

  @Roles(Role.ADMIN)
  @Get(':id')
  @ApiOperation({ summary: 'Consulter un compte' })
  @ApiOkResponse({ description: 'Le compte demandé.', type: UtilisateurExpose })
  @ApiNotFoundResponse({
    description: 'Compte inconnu.',
    type: ReponseErreurDto,
  })
  async trouver(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UtilisateurExpose> {
    return exposerUtilisateur(await this.userService.trouverOuEchouer(id));
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  @ApiOperation({
    summary: 'Modifier un compte',
    description:
      'Rôle, activation et correction du marquage de finissant. La ' +
      'désactivation conserve l’historique et coupe les sessions en cours. Un ' +
      'administrateur ne peut ni se retirer son rôle, ni se désactiver, ni ' +
      'retirer le rôle du dernier administrateur restant.',
  })
  @ApiOkResponse({
    description: 'Le compte mis à jour.',
    type: UtilisateurExpose,
  })
  @ApiResponse({
    status: 403,
    description: 'Opération qui rendrait la plateforme ingérable.',
    type: ReponseErreurDto,
  })
  @ApiNotFoundResponse({
    description: 'Compte inconnu.',
    type: ReponseErreurDto,
  })
  async administrer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MettreAJourUtilisateurDto,
    @Req() requete: Requete,
  ): Promise<UtilisateurExpose> {
    return exposerUtilisateur(
      await this.userService.administrer(id, dto, requete.user.id),
    );
  }
}
