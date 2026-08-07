import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import {
  LIMITE_AUTHENTIFICATION,
  LIMITE_ENVOI_EMAIL,
  LimiteDebit,
} from '../../common/guards/limite-debit.decorator';
import { Public } from './decorators/public.decorator';
import { ConnexionDto } from './dto/connexion.dto';
import { ConfirmerChangementEmailDto } from './dto/changement-email.dto';
import { DefinirMotDePasseDto } from './dto/definir-mot-de-passe.dto';
import { DemandeReinitialisationDto } from './dto/demande-reinitialisation.dto';
import { InscriptionDto } from './dto/inscription.dto';
import { RafraichirDto } from './dto/rafraichir.dto';
import { VerifierEmailDto } from './dto/verifier-email.dto';
import { TypeJeton } from './entities/jeton-auth.entity';
import { AuthService, PaireJetons } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/** Réponse volontairement identique quel que soit le cas rencontré. */
const REPONSE_NEUTRE = {
  message:
    "Si cette adresse peut être utilisée, un email vient d'y être envoyé.",
};

@ApiTags('authentification')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @LimiteDebit(LIMITE_ENVOI_EMAIL)
  @Post('inscription')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Créer un compte',
    description:
      "La réponse est identique que l'adresse soit libre ou déjà utilisée : " +
      "révéler la différence permettrait d'énumérer les comptes existants. " +
      'Le compte reste inutilisable tant que le lien reçu par email n’a pas été suivi.',
  })
  @ApiResponse({ status: 202, description: 'Demande prise en compte.' })
  async inscription(@Body() dto: InscriptionDto): Promise<{ message: string }> {
    await this.authService.inscrire(
      dto.email,
      dto.motDePasse,
      dto.prenom,
      dto.nom,
    );
    return REPONSE_NEUTRE;
  }

  @Public()
  @LimiteDebit(LIMITE_AUTHENTIFICATION)
  @Post('verification-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Confirmer l'adresse et activer le compte",
    description:
      "Accorde le rôle étudiant si l'adresse est institutionnelle : c'est la " +
      'seule preuve que la boîte appartient bien à la personne inscrite. ' +
      'Ouvre directement une session.',
  })
  verifierEmail(@Body() dto: VerifierEmailDto): Promise<PaireJetons> {
    return this.authService.verifierEmail(dto.jeton);
  }

  @Public()
  @LimiteDebit(LIMITE_ENVOI_EMAIL)
  @Post('verification-email/renvoyer')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Renvoyer le lien de confirmation' })
  async renvoyerVerification(
    @Body() dto: DemandeReinitialisationDto,
  ): Promise<{ message: string }> {
    await this.authService.renvoyerVerification(dto.email);
    return REPONSE_NEUTRE;
  }

  @Public()
  @LimiteDebit(LIMITE_AUTHENTIFICATION)
  @Post('connexion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Se connecter',
    description:
      "Un échec renvoie toujours le même message, qu'il s'agisse d'une adresse " +
      "inconnue, d'un mot de passe erroné ou d'un compte non confirmé.",
  })
  @ApiResponse({ status: 401, description: 'Identifiants invalides.' })
  connexion(@Body() dto: ConnexionDto): Promise<PaireJetons> {
    return this.authService.connecter(dto.email, dto.motDePasse);
  }

  @Public()
  @LimiteDebit(LIMITE_AUTHENTIFICATION)
  @Post('rafraichir')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Renouveler la session',
    description:
      'Chaque renouvellement invalide le jeton précédent. Rejouer un ancien ' +
      'jeton révoque toutes les sessions : le vol est alors la cause la plus probable.',
  })
  rafraichir(@Body() dto: RafraichirDto): Promise<PaireJetons> {
    return this.authService.rafraichir(dto.refreshToken);
  }

  @Post('deconnexion')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Se déconnecter',
    description:
      'Invalide le refresh token côté serveur : la déconnexion ne repose pas ' +
      'sur le seul oubli du jeton par le client. Idempotent.',
  })
  async deconnexion(@Req() requete: Request): Promise<void> {
    const utilisateur = requete.user as { id: string };
    await this.authService.deconnecter(utilisateur.id);
  }

  @Public()
  @LimiteDebit(LIMITE_ENVOI_EMAIL)
  @Post('mot-de-passe/oublie')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Demander une réinitialisation',
    description:
      "La réponse ne dit pas si l'adresse est connue, pour la même raison qu'à l'inscription.",
  })
  async motDePasseOublie(
    @Body() dto: DemandeReinitialisationDto,
  ): Promise<{ message: string }> {
    await this.authService.demanderReinitialisation(dto.email);
    return REPONSE_NEUTRE;
  }

  @Public()
  @LimiteDebit(LIMITE_AUTHENTIFICATION)
  @Post('mot-de-passe/reinitialiser')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Définir un nouveau mot de passe',
    description: 'Met fin aux sessions ouvertes ailleurs.',
  })
  reinitialiserMotDePasse(
    @Body() dto: DefinirMotDePasseDto,
  ): Promise<PaireJetons> {
    return this.authService.definirMotDePasse(
      dto.jeton,
      dto.motDePasse,
      TypeJeton.REINITIALISATION_MOT_DE_PASSE,
    );
  }

  @Public()
  @LimiteDebit(LIMITE_AUTHENTIFICATION)
  @Post('email/confirmer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirmer une nouvelle adresse',
    description:
      'Le lien part vers l’adresse demandée : le suivre prouve qu’on y a ' +
      'accès. Les attributs de promotion sont alors recalculés — l’adresse est ' +
      'ce qui atteste l’appartenance. Les rôles ADMIN et SPONSOR ne bougent ' +
      'pas : ils viennent du bureau ou d’un partenariat, pas d’un domaine.',
  })
  @ApiResponse({ status: 409, description: 'Adresse prise entre-temps.' })
  confirmerChangementEmail(
    @Body() dto: ConfirmerChangementEmailDto,
  ): Promise<PaireJetons> {
    return this.authService.confirmerChangementEmail(dto.jeton);
  }

  @Public()
  @LimiteDebit(LIMITE_AUTHENTIFICATION)
  @Post('invitation/activer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Activer un accès partenaire',
    description:
      "Le sponsor choisit lui-même son mot de passe : le bureau n'en génère " +
      "ni n'en transmet aucun. Le clic vaut également confirmation de l’adresse.",
  })
  activerInvitation(@Body() dto: DefinirMotDePasseDto): Promise<PaireJetons> {
    return this.authService.definirMotDePasse(
      dto.jeton,
      dto.motDePasse,
      TypeJeton.INVITATION_SPONSOR,
    );
  }
}
