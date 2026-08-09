import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
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
import { PeriodeDto } from '../tableau-de-bord/dto/tableau-de-bord.dto';
import { Demandeur, DocumentService } from './document.service';
import { Document } from './entities/document.entity';

type RequeteAuthentifiee = Request & { user: { id: string; role: Role } };

/** Ce que le service attend, extrait du jeton porté par la requête. */
const demandeur = (requete: RequeteAuthentifiee): Demandeur => ({
  id: requete.user.id,
  role: requete.user.role,
});

@ApiTags('Documents')
@ApiBearerAuth()
@ApiErreursAuthentification()
@ApiErreurValidation()
@Controller('documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post('facture-commande/:commandeId')
  @ApiOperation({
    summary: 'Émettre la facture d’une commande',
    description:
      'Idempotent : redemander la facture d’une commande rend la même pièce, ' +
      'avec le même numéro. Refusé tant que le paiement n’a pas abouti — une ' +
      'facture atteste d’un règlement.',
  })
  @ApiCreatedResponse({ description: 'La facture.', type: Document })
  @ApiNotFoundResponse({
    description: 'Commande inconnue.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Commande non réglée.',
    type: ReponseErreurDto,
  })
  @ApiForbiddenResponse({
    description: 'Commande d’un autre compte.',
    type: ReponseErreurDto,
  })
  factureCommande(
    @Param('commandeId', ParseUUIDPipe) commandeId: string,
    @Req() requete: RequeteAuthentifiee,
  ): Promise<Document> {
    return this.documentService.factureCommande(commandeId, demandeur(requete));
  }

  @Post('recu-billetterie/:inscriptionId')
  @ApiOperation({
    summary: 'Émettre le reçu d’une inscription',
    description:
      'Idempotent, comme la facture. Le reçu atteste du règlement ; il ne ' +
      'tient pas lieu de billet.',
  })
  @ApiCreatedResponse({ description: 'Le reçu.', type: Document })
  @ApiNotFoundResponse({
    description: 'Inscription inconnue.',
    type: ReponseErreurDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Inscription non réglée.',
    type: ReponseErreurDto,
  })
  @ApiForbiddenResponse({
    description: 'Inscription d’un autre compte.',
    type: ReponseErreurDto,
  })
  recuBilletterie(
    @Param('inscriptionId', ParseUUIDPipe) inscriptionId: string,
    @Req() requete: RequeteAuthentifiee,
  ): Promise<Document> {
    return this.documentService.recuBilletterie(
      inscriptionId,
      demandeur(requete),
    );
  }

  @Post('rapport-tresorerie')
  @Roles(Role.ADMIN)
  @UseGuards(PrivilegeGuard)
  @ExigePrivilege(Privilege.TRESORERIE)
  @ApiOperation({
    summary: 'Établir un rapport de trésorerie',
    description:
      'Fige les chiffres de la période demandée. **Non idempotent**, à ' +
      'l’inverse des deux autres : deux rapports sur la même période doivent ' +
      'pouvoir coexister, puisque les chiffres bougent entre-temps. Le nom de ' +
      'l’émetteur figure sur la pièce.',
  })
  @ApiCreatedResponse({ description: 'Le rapport.', type: Document })
  @ApiForbiddenResponse({
    description: 'Poste sans accès à la trésorerie.',
    type: ReponseErreurDto,
  })
  rapportTresorerie(
    @Query() periode: PeriodeDto,
    @Req() requete: RequeteAuthentifiee,
  ): Promise<Document> {
    return this.documentService.rapportTresorerie(periode, demandeur(requete));
  }

  @Get(':id/fichier')
  @ApiOperation({
    summary: 'Télécharger le PDF d’un document',
    description:
      'Les fichiers sont purgés au-delà de trois mois, mais la pièce ne l’est ' +
      'jamais : elle se régénère alors à l’identique depuis son contenu figé. ' +
      'La différence ne se voit qu’à quelques millisecondes près.',
  })
  @ApiOkResponse({ description: 'Le PDF.' })
  @ApiNotFoundResponse({
    description: 'Document inconnu.',
    type: ReponseErreurDto,
  })
  @ApiForbiddenResponse({
    description: 'Document d’un autre compte.',
    type: ReponseErreurDto,
  })
  async fichier(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() requete: RequeteAuthentifiee,
    @Res() reponse: Response,
  ): Promise<void> {
    const { document, octets } = await this.documentService.fichier(
      id,
      demandeur(requete),
    );

    // Les octets sont servis par l'API plutôt que par une URL signée : le
    // document peut avoir à être régénéré, et il n'existe alors nulle part
    // vers où pointer au moment de répondre.
    reponse
      .set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${document.numero}.pdf"`,
        'Content-Length': String(octets.length),
      })
      .end(octets);
  }
}
