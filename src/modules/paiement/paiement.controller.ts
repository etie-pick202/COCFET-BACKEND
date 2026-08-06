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

/**
 * En-têtes susceptibles de porter la signature.
 *
 * ⚠️ Le nom exact est à confirmer contre l'API réelle. En accepter plusieurs
 * évite qu'une différence de casse ou de préfixe fasse rejeter en bloc des
 * notifications légitimes — l'échec serait silencieux côté client, et se
 * traduirait par des billets payés jamais confirmés.
 */
const ENTETES_SIGNATURE = [
  'x-notch-signature',
  'x-notchpay-signature',
  'notch-signature',
];

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
   * nous. **C'est la signature qui tient lieu d'authentification** — sans elle,
   * n'importe qui pourrait déclarer une commande payée.
   *
   * Répond toujours 200 après un traitement réussi, y compris sur un rejeu :
   * un code d'erreur relancerait les tentatives du prestataire pour une
   * notification que nous avons déjà prise en compte.
   */
  @Public()
  @Post('notchpay')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async notchpay(
    @Req() requete: RequeteWebhook,
  ): Promise<{ recu: true; traite: boolean }> {
    const corpsBrut = requete.rawBody;
    if (!corpsBrut?.length) {
      // Sans corps brut, la signature ne peut pas être vérifiée : mieux vaut
      // refuser que valider sur un corps resérialisé, dont l'ordre des clés a
      // changé.
      this.logger.error(
        'Webhook reçu sans corps brut : vérifiez « rawBody: true » au démarrage.',
      );
      throw new Error('Corps brut indisponible.');
    }

    const evenement = this.passerelle.interpreterWebhook(
      corpsBrut,
      this.signature(requete),
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

    return { recu: true, traite: nouveau };
  }

  private signature(requete: RequeteWebhook): string | undefined {
    for (const entete of ENTETES_SIGNATURE) {
      const valeur = requete.headers[entete];
      if (typeof valeur === 'string' && valeur.length > 0) {
        return valeur;
      }
    }
    return undefined;
  }
}
