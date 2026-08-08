import {
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { BilletterieService } from '../billetterie/billetterie.service';
import { StatutPaiement } from './enums/paiement.enum';
import type { PasserellePaiement } from './ports/passerelle-paiement';
import { PASSERELLE_PAIEMENT } from './ports/passerelle-paiement';
import { TransactionService } from './transaction.service';

/** Le corps brut, préservé par `rawBody: true` au démarrage. */
type RequeteWebhook = Request & { rawBody?: Buffer };

@ApiTags('Paiement')
@Controller('webhooks')
export class PaiementController {
  private readonly logger = new Logger(PaiementController.name);

  constructor(
    @Inject(PASSERELLE_PAIEMENT)
    private readonly passerelle: PasserellePaiement,
    private readonly transactionService: TransactionService,
    private readonly billetterieService: BilletterieService,
  ) {}

  /**
   * Notification de paiement.
   *
   * Route publique : l'appelant est le prestataire, qui n'a pas de compte chez
   * nous. L'en-tête `x-wh-secret` tient lieu d'authentification — mais il ne
   * couvre que l'appelant, jamais le contenu. **L'état retenu est donc
   * redemandé à Fapshi** par l'adaptateur : ce corps ne sert qu'à désigner la
   * transaction, et une notification forgée ne mène nulle part.
   *
   * Répond toujours 200 après un traitement réussi, y compris sur un rejeu :
   * un code d'erreur relancerait les tentatives du prestataire pour une
   * notification que nous avons déjà prise en compte.
   */
  @Public()
  @Post('fapshi')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async fapshi(
    @Req() requete: RequeteWebhook,
  ): Promise<{ recu: true; traite: boolean }> {
    const corpsBrut = requete.rawBody;
    if (!corpsBrut?.length) {
      // Le corps brut reste exigé : c'est lui qui porte la transaction à
      // désigner, et le conserver garde la porte ouverte à un prestataire qui
      // signerait ses octets.
      this.logger.error(
        'Webhook reçu sans corps brut : vérifiez « rawBody: true » au démarrage.',
      );
      throw new Error('Corps brut indisponible.');
    }

    // L'adaptateur authentifie puis **redemande** l'état au prestataire : le
    // corps reçu ne fait pas foi, il ne fait que désigner la transaction.
    const evenement = await this.passerelle.interpreterWebhook(
      corpsBrut,
      requete.headers,
    );

    // Le dédoublonnage précède l'effet de bord : le prestataire renvoie la
    // même notification plusieurs fois, c'est son mécanisme de livraison.
    const nouveau = await this.transactionService.appliquer(
      evenement.reference,
      evenement.statut,
    );

    if (nouveau && evenement.statut === StatutPaiement.COMPLETE) {
      await this.billetterieService.confirmerPaiement(evenement.reference);
    }

    // L'échec était jusqu'ici ignoré : l'inscription restait en attente pour
    // toujours, occupant une place que personne ne paierait.
    if (nouveau && evenement.statut === StatutPaiement.ECHOUE) {
      await this.billetterieService.echouerPaiement(
        evenement.reference,
        'le paiement a été refusé par l’opérateur.',
      );
    }

    return { recu: true, traite: nouveau };
  }
}
