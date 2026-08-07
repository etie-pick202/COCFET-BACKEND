import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { StatutPaiement } from '../enums/paiement.enum';
import {
  DemandePaiement,
  EntetesWebhook,
  EvenementPaiement,
  PasserellePaiement,
  ResultatPaiement,
} from '../ports/passerelle-paiement';

/**
 * Numéros du bac à sable Fapshi, repris tels quels.
 *
 * Le même numéro produit ainsi la même issue en local et en bac à sable : un
 * scénario écrit contre le double se rejoue contre Fapshi sans rien changer,
 * et personne n'a deux conventions à retenir.
 */
const NUMEROS_SUCCES = new Set([
  '670000000',
  '670000002',
  '650000000',
  '690000000',
  '690000002',
  '656000000',
]);

const NUMEROS_ECHEC = new Set([
  '670000001',
  '670000003',
  '650000001',
  '690000001',
  '690000003',
  '656000001',
]);

/** En-tête portant le secret, tel que Fapshi le nomme. */
const ENTETE_SECRET = 'x-wh-secret';

/**
 * Passerelle de développement : aucun argent ne circule.
 *
 * Elle imite volontairement les contraintes du vrai prestataire plutôt que de
 * tout accepter. Un double complaisant laisserait écrire du code qui ne
 * fonctionne qu'avec lui — secret de notification ignoré, référence
 * réutilisée, échec de paiement jamais rencontré — et le passage en
 * production découvrirait ces cas en même temps que les premiers vrais
 * paiements.
 *
 * Les numéros du bac à sable Fapshi pilotent l'issue :
 *   - `670000000`, `690000000`, `650000000`… → paiement accepté
 *   - `670000001`, `690000001`, `650000001`… → paiement refusé
 *   - tout autre numéro → reste en attente
 *
 * Deux écarts assumés avec Fapshi, tous deux au service des tests :
 *
 * 1. Fapshi rend une issue **aléatoire** sur un numéro non répertorié ; ici
 *    l'attente est systématique, sans quoi aucun test ne serait reproductible.
 * 2. Fapshi ne tranche jamais dès l'appel — `direct-pay` accuse réception et
 *    l'issue arrive par notification. Le double, lui, tranche immédiatement :
 *    sans cela, éprouver un parcours payant exigerait de simuler un webhook à
 *    chaque fois. Le parcours par notification reste couvert à part, par les
 *    tests du webhook.
 */
@Injectable()
export class PasserellePaiementFactice implements PasserellePaiement {
  private readonly logger = new Logger(PasserellePaiementFactice.name);
  private readonly secretWebhook: string;

  /** Intentions ouvertes, indexées par référence. */
  private readonly intentions = new Map<string, ResultatPaiement>();

  constructor(config: ConfigService) {
    this.secretWebhook = config.get<string>(
      'FAPSHI_WEBHOOK_SECRET',
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

  // eslint-disable-next-line @typescript-eslint/require-await
  async interpreterWebhook(
    corpsBrut: Buffer,
    entetes: EntetesWebhook,
  ): Promise<EvenementPaiement> {
    if (!this.secretValide(entetes)) {
      // Sans ce contrôle, n'importe qui pourrait déclarer une commande payée.
      throw new BadRequestException('Notification non authentifiée.');
    }

    // Le corps est cru sur parole, là où l'adaptateur Fapshi redemande l'état
    // au prestataire : ici le double **est** le prestataire, il n'a personne
    // à qui reposer la question.
    const evenement = JSON.parse(
      corpsBrut.toString('utf8'),
    ) as EvenementPaiement;

    this.intentions.set(evenement.reference, {
      ...evenement,
      urlRedirection: null,
    });

    return evenement;
  }

  /** Numéro qui simule un paiement accepté — réservé aux tests. */
  static numeroQuiReussit(): string {
    return '670000000';
  }

  /** Numéro qui simule un paiement refusé — réservé aux tests. */
  static numeroQuiEchoue(): string {
    return '670000001';
  }

  /** Numéro qui laisse le paiement en attente — réservé aux tests. */
  static numeroQuiAttend(): string {
    return '677123456';
  }

  private secretValide(entetes: EntetesWebhook): boolean {
    const brut = entetes[ENTETE_SECRET];
    const fourni = Array.isArray(brut) ? brut[0] : brut;

    if (!fourni) {
      return false;
    }

    const attendu = Buffer.from(this.secretWebhook);
    const presente = Buffer.from(fourni.trim());

    // timingSafeEqual exige des longueurs égales et lève sinon : on écarte ce
    // cas d'abord, il ne révèle rien qu'un secret mal formé n'expose déjà.
    return (
      attendu.length === presente.length && timingSafeEqual(attendu, presente)
    );
  }

  /**
   * Issue déduite du numéro, comme le fait le bac à sable Fapshi.
   *
   * L'indicatif est retiré d'abord : `+237670000000` et `670000000` désignent
   * la même ligne, et les deux formes circulent dans les tests.
   */
  private issue(telephone: string): StatutPaiement {
    const numero = telephone.replace(/\D/g, '').replace(/^237/, '');

    if (NUMEROS_SUCCES.has(numero)) {
      return StatutPaiement.COMPLETE;
    }
    if (NUMEROS_ECHEC.has(numero)) {
      return StatutPaiement.ECHOUE;
    }
    return StatutPaiement.EN_ATTENTE;
  }
}
