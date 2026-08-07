import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { StatutPaiement } from '../enums/paiement.enum';
import {
  DemandePaiement,
  EvenementPaiement,
  PasserellePaiement,
  ResultatPaiement,
} from '../ports/passerelle-paiement';

/**
 * Passerelle de développement : aucun argent ne circule.
 *
 * Elle imite volontairement les contraintes du vrai prestataire plutôt que de
 * tout accepter. Un double complaisant laisserait écrire du code qui ne
 * fonctionne qu'avec lui — signature de webhook ignorée, référence réutilisée,
 * échec de paiement jamais rencontré — et le passage en production
 * découvrirait ces cas en même temps que les premiers vrais paiements.
 *
 * Le dernier chiffre du numéro pilote l'issue, ce qui rend les scénarios
 * d'échec reproductibles :
 *   - se terminant par 0 → paiement refusé
 *   - se terminant par 1 → reste en attente (webhook jamais reçu)
 *   - sinon              → paiement accepté
 */
@Injectable()
export class PasserellePaiementFactice implements PasserellePaiement {
  private readonly logger = new Logger(PasserellePaiementFactice.name);
  private readonly secretWebhook: string;

  /** Intentions ouvertes, indexées par référence. */
  private readonly intentions = new Map<string, ResultatPaiement>();

  constructor(config: ConfigService) {
    this.secretWebhook = config.get<string>(
      'NOTCHPAY_WEBHOOK_SECRET',
      'secret-de-developpement',
    );
  }

  // `async` et non un simple `Promise` de retour : une méthode asynchrone qui
  // lève de façon synchrone échappe aux `.catch()` de l'appelant et remonte en
  // exception non capturée.
  // eslint-disable-next-line @typescript-eslint/require-await
  async initier(demande: DemandePaiement): Promise<ResultatPaiement> {
    if (!Number.isInteger(demande.montant) || demande.montant <= 0) {
      // Le FCFA n'a pas de centime : un montant décimal est un bug d'appelant,
      // pas une valeur à arrondir en silence.
      throw new BadRequestException('Le montant doit être un entier positif.');
    }

    const dejaVue = this.intentions.get(demande.reference);
    if (dejaVue) {
      // Idempotence : le vrai prestataire renvoie l'intention existante plutôt
      // que d'en créer une seconde, et donc de débiter deux fois.
      return dejaVue;
    }

    const resultat: ResultatPaiement = {
      reference: demande.reference,
      referenceExterne: `factice_${randomUUID()}`,
      statut: this.issue(demande.telephone),
      urlRedirection: null,
    };

    this.intentions.set(demande.reference, resultat);
    this.logger.log(
      `Paiement simulé ${demande.reference} : ${resultat.statut} (${demande.montant} FCFA)`,
    );

    return resultat;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async verifier(reference: string): Promise<ResultatPaiement> {
    const intention = this.intentions.get(reference);
    if (!intention) {
      throw new BadRequestException('Référence de paiement inconnue.');
    }
    return intention;
  }

  interpreterWebhook(corpsBrut: Buffer, signature?: string): EvenementPaiement {
    if (!signature || !this.signatureValide(corpsBrut, signature)) {
      // Sans ce contrôle, n'importe qui pourrait déclarer une commande payée.
      throw new BadRequestException('Signature de webhook invalide.');
    }

    const evenement = JSON.parse(
      corpsBrut.toString('utf8'),
    ) as EvenementPaiement;
    this.intentions.set(evenement.reference, {
      ...evenement,
      urlRedirection: null,
    });

    return evenement;
  }

  /** Signe un corps comme le ferait le prestataire — réservé aux tests. */
  signer(corpsBrut: Buffer): string {
    return createHmac('sha256', this.secretWebhook)
      .update(corpsBrut)
      .digest('hex');
  }

  private signatureValide(corpsBrut: Buffer, signature: string): boolean {
    const attendue = Buffer.from(this.signer(corpsBrut));
    const fournie = Buffer.from(signature);

    // timingSafeEqual exige des longueurs égales et lève sinon : on écarte ce
    // cas d'abord, il ne révèle rien qu'une signature mal formée n'expose déjà.
    return (
      attendue.length === fournie.length && timingSafeEqual(attendue, fournie)
    );
  }

  private issue(telephone: string): StatutPaiement {
    switch (telephone.trim().slice(-1)) {
      case '0':
        return StatutPaiement.ECHOUE;
      case '1':
        return StatutPaiement.EN_ATTENTE;
      default:
        return StatutPaiement.COMPLETE;
    }
  }
}
