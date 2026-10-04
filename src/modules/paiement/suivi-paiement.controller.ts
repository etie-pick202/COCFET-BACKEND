import { Controller, Get, NotFoundException, Param, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ReponseErreurDto } from '../../common/swagger';
import { OrigineTransaction } from './entities/transaction.entity';
import { StatutPaiement } from './enums/paiement.enum';
import { ReconciliationService } from './reconciliation.service';
import { TransactionService } from './transaction.service';

type Requete = Request & { user: { id: string } };

export class SuiviPaiement {
  @ApiProperty({ example: 'COCFET-1A2B3C4D5E6F' })
  reference: string;

  @ApiProperty({ enum: OrigineTransaction })
  origine: OrigineTransaction;

  @ApiProperty({ enum: StatutPaiement })
  statut: StatutPaiement;

  @ApiProperty({ description: 'Montant débité, frais compris, en FCFA.' })
  montant: number;

  @ApiProperty({
    example: '/billets/7f0c…/qr',
    description:
      'Page du frontal où retrouver ce qui a été payé : le billet, la ' +
      'commande, ou les cotisations.',
  })
  destination: string;
}

/**
 * Suivi d'un paiement par son payeur.
 *
 * C'est ce que la page de retour interroge. Elle devinait jusqu'ici le
 * paiement concerné en parcourant les dernières commandes et les derniers
 * billets, sans tenir compte de la référence que le prestataire lui
 * transmet — et ignorait les cotisations. Elle sait désormais exactement de
 * quoi il s'agit, et où renvoyer la personne une fois le paiement abouti.
 */
@ApiTags('Paiements')
@ApiBearerAuth()
@Controller('paiements')
export class SuiviPaiementController {
  constructor(
    private readonly transactionService: TransactionService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Get(':reference')
  @ApiOperation({
    summary: 'Où en est mon paiement',
    description:
      'Réservé au payeur. Un paiement resté en attente au-delà de quelques ' +
      'secondes est vérifié auprès du prestataire sur-le-champ : si sa ' +
      'notification s’est perdue, le payeur n’attend pas la réconciliation.',
  })
  @ApiOkResponse({ type: SuiviPaiement })
  @ApiNotFoundResponse({
    description: 'Référence inconnue, ou paiement d’autrui.',
    type: ReponseErreurDto,
  })
  async suivre(
    @Req() requete: Requete,
    @Param('reference') reference: string,
  ): Promise<SuiviPaiement> {
    const avant = await this.transactionService.trouver(reference);

    // Le titulaire fait partie de la condition : connaître une référence ne
    // doit pas suffire à lire le paiement de quelqu'un d'autre.
    if (!avant || avant.user?.id !== requete.user.id) {
      throw new NotFoundException('Aucun paiement ne porte cette référence.');
    }

    await this.reconciliation.verifierMaintenant(avant);
    const transaction =
      (await this.transactionService.trouver(reference)) ?? avant;

    return {
      reference: transaction.reference,
      origine: transaction.origine,
      statut: transaction.statut,
      montant: transaction.montant,
      destination: await this.transactionService.destination(transaction),
    };
  }
}
