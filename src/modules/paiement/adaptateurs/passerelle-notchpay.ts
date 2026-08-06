import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { MethodePaiement, StatutPaiement } from '../enums/paiement.enum';
import {
  DemandePaiement,
  EvenementPaiement,
  PasserellePaiement,
  ResultatPaiement,
} from '../ports/passerelle-paiement';

/**
 * Adaptateur NotchPay.
 *
 * ⚠️ **Écrit contre la documentation, jamais exécuté contre l'API réelle** —
 * le compte marchand n'est pas encore ouvert. Trois points sont à confirmer au
 * premier essai en conditions réelles, et sont signalés dans le code :
 * le nom de l'en-tête de signature, les libellés de statut, et la forme exacte
 * du corps de webhook. Le reste — ordre des appels, gestion d'erreur,
 * idempotence — ne dépend pas de ces détails.
 *
 * La correspondance des statuts est **volontairement stricte** : un libellé
 * inconnu n'est pas interprété comme un succès, il lève. Traiter par défaut
 * comme « payé » ce qu'on ne comprend pas est la façon la plus directe de
 * livrer des billets non réglés.
 */
@Injectable()
export class PasserelleNotchPay implements PasserellePaiement {
  private readonly logger = new Logger(PasserelleNotchPay.name);
  private readonly baseUrl: string;
  private readonly clePublique: string;
  private readonly cleSecrete: string;
  private readonly secretWebhook: string;

  /** Au-delà, on rend la main : l'appelant tient une requête HTTP ouverte. */
  private static readonly DELAI_MS = 15_000;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>(
      'NOTCHPAY_BASE_URL',
      'https://api.notchpay.co',
    );
    this.clePublique = config.getOrThrow<string>('NOTCHPAY_PUBLIC_KEY');
    this.cleSecrete = config.getOrThrow<string>('NOTCHPAY_SECRET_KEY');
    this.secretWebhook = config.getOrThrow<string>('NOTCHPAY_WEBHOOK_SECRET');
  }

  async initier(demande: DemandePaiement): Promise<ResultatPaiement> {
    if (!Number.isInteger(demande.montant) || demande.montant <= 0) {
      // Le FCFA n'a pas de sous-unité : une décimale produirait un écart
      // silencieux avec le relevé du prestataire.
      throw new BadRequestException('Le montant doit être un entier positif.');
    }

    const corps = await this.appeler('POST', '/payments', {
      amount: demande.montant,
      currency: 'XAF',
      description: demande.description,
      // Notre référence voyage jusqu'au webhook : c'est elle qui permet de
      // retrouver l'inscription au retour, sans table de correspondance.
      reference: demande.reference,
      customer: { phone: demande.telephone },
      channel: this.canal(demande.methode),
    });

    return this.versResultat(demande.reference, corps);
  }

  async verifier(reference: string): Promise<ResultatPaiement> {
    const corps = await this.appeler(
      'GET',
      `/payments/${encodeURIComponent(reference)}`,
    );

    return this.versResultat(reference, corps);
  }

  /**
   * Valide la signature d'un webhook et en extrait l'état du paiement.
   *
   * Le corps **brut** est exigé : désérialiser puis resérialiser réordonne les
   * clés et change les espaces, ce qui invalide la signature. C'est l'erreur
   * classique sur ce type d'intégration, et elle ne se voit qu'en production.
   */
  interpreterWebhook(corpsBrut: Buffer, signature?: string): EvenementPaiement {
    if (!signature || !this.signatureValide(corpsBrut, signature)) {
      // Sans ce contrôle, n'importe qui pourrait déclarer une commande payée
      // en appelant l'endpoint avec un corps de son choix.
      throw new BadRequestException('Signature de webhook invalide.');
    }

    const charge = this.analyser(corpsBrut);
    // ⚠️ À confirmer : NotchPay peut envelopper les données dans « data ».
    const donnees = (charge.data ?? charge) as Record<string, unknown>;
    const transaction = (donnees.transaction ?? donnees) as Record<
      string,
      unknown
    >;

    const reference = this.chaine(transaction, [
      'merchant_reference',
      'reference',
    ]);
    if (!reference) {
      throw new BadRequestException('Webhook sans référence exploitable.');
    }

    return {
      reference,
      referenceExterne:
        this.chaine(transaction, ['reference', 'trxref', 'id']) ?? reference,
      statut: this.versStatut(this.chaine(transaction, ['status'])),
    };
  }

  // ──────────────────────────────  Interne  ─────────────────────────────

  private async appeler(
    methode: 'GET' | 'POST',
    chemin: string,
    corps?: unknown,
  ): Promise<Record<string, unknown>> {
    let reponse: Response;

    try {
      reponse = await fetch(`${this.baseUrl}${chemin}`, {
        method: methode,
        headers: {
          // NotchPay attend la clé publique en Authorization, et la clé
          // secrète en X-Grant pour les opérations engageantes.
          Authorization: this.clePublique,
          'X-Grant': this.cleSecrete,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: corps === undefined ? undefined : JSON.stringify(corps),
        signal: AbortSignal.timeout(PasserelleNotchPay.DELAI_MS),
      });
    } catch (erreur) {
      // Réseau coupé ou délai dépassé : l'état du paiement est **inconnu**, et
      // surtout pas « échoué ». L'appelant doit pouvoir le vérifier plus tard.
      this.logger.error(
        `NotchPay injoignable (${methode} ${chemin}) : ${(erreur as Error).message}`,
      );
      throw new BadGatewayException(
        'Le service de paiement est momentanément injoignable. Réessayez.',
      );
    }

    const charge = (await reponse.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!reponse.ok) {
      // Le message du prestataire est journalisé mais pas renvoyé tel quel :
      // il peut contenir des détails d'intégration sans intérêt pour la
      // personne qui paie.
      this.logger.error(
        `NotchPay a répondu ${reponse.status} : ${JSON.stringify(charge).slice(0, 300)}`,
      );
      throw new BadGatewayException(
        'Le paiement n’a pas pu être initié. Réessayez dans un instant.',
      );
    }

    return charge;
  }

  private versResultat(
    reference: string,
    corps: Record<string, unknown>,
  ): ResultatPaiement {
    const transaction = (corps.transaction ?? corps.data ?? corps) as Record<
      string,
      unknown
    >;

    return {
      reference,
      referenceExterne:
        this.chaine(transaction, ['reference', 'id']) ?? reference,
      statut: this.versStatut(this.chaine(transaction, ['status'])),
      urlRedirection:
        this.chaine(corps, ['authorization_url']) ??
        this.chaine(transaction, ['authorization_url']) ??
        null,
    };
  }

  /**
   * ⚠️ Libellés à confirmer contre l'API réelle.
   *
   * Un statut inconnu lève au lieu d'être rangé par défaut : la valeur par
   * défaut la plus tentante — « en attente » — masquerait un échec, et
   * « complété » livrerait des billets non payés.
   */
  private versStatut(statut?: string): StatutPaiement {
    switch (statut?.toLowerCase()) {
      case 'complete':
      case 'completed':
      case 'success':
      case 'successful':
        return StatutPaiement.COMPLETE;
      case 'pending':
      case 'processing':
      case 'initialized':
        return StatutPaiement.EN_ATTENTE;
      case 'failed':
      case 'canceled':
      case 'cancelled':
      case 'rejected':
      case 'expired':
        return StatutPaiement.ECHOUE;
      default:
        this.logger.error(
          `Statut NotchPay inconnu : « ${statut ?? 'absent'} »`,
        );
        throw new BadGatewayException(
          'Réponse inattendue du service de paiement.',
        );
    }
  }

  /** ⚠️ Identifiants de canal à confirmer contre la console NotchPay. */
  private canal(methode: MethodePaiement): string {
    return methode === MethodePaiement.ORANGE_MONEY ? 'cm.orange' : 'cm.mtn';
  }

  private signatureValide(corpsBrut: Buffer, signature: string): boolean {
    const attendue = Buffer.from(
      createHmac('sha256', this.secretWebhook).update(corpsBrut).digest('hex'),
    );
    const fournie = Buffer.from(signature.trim());

    // timingSafeEqual exige des longueurs égales et lève sinon : on écarte ce
    // cas d'abord, il ne révèle rien qu'une signature mal formée n'expose déjà.
    return (
      attendue.length === fournie.length && timingSafeEqual(attendue, fournie)
    );
  }

  private analyser(corpsBrut: Buffer): Record<string, unknown> {
    try {
      return JSON.parse(corpsBrut.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Corps de webhook illisible.');
    }
  }

  private chaine(
    source: Record<string, unknown>,
    cles: string[],
  ): string | undefined {
    for (const cle of cles) {
      const valeur = source[cle];
      if (typeof valeur === 'string' && valeur.length > 0) {
        return valeur;
      }
    }
    return undefined;
  }
}
