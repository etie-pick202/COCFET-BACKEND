import { MethodePaiement, StatutPaiement } from '../enums/paiement.enum';

/**
 * Contrat que doit respecter tout prestataire de paiement mobile.
 *
 * La billetterie et la boutique ne connaissent que cette interface : changer
 * de prestataire se joue dans un adaptateur, sans qu'aucun appelant bouge.
 */
export interface PasserellePaiement {
  /**
   * Ouvre une intention de paiement.
   *
   * `reference` est produite par nous et sert de clé d'idempotence : rejouer
   * la même référence ne doit jamais créer un second débit.
   */
  initier(demande: DemandePaiement): Promise<ResultatPaiement>;

  /** Interroge le prestataire. Sert de filet quand le webhook se perd. */
  verifier(reference: string): Promise<ResultatPaiement>;

  /**
   * Invalide une intention de paiement encore ouverte.
   *
   * Appelee quand la commande ou l'inscription disparait avant son reglement :
   * sans cela, la page de paiement reste ouverte chez le prestataire et
   * quelqu'un peut encore la regler, alors que le stock ou la place ont deja
   * ete rendus.
   *
   * **Ne leve jamais.** C'est une politesse envers le payeur, pas une garantie
   * d'integrite : celle-ci tient au refus de confirmer un ordre annule, qui ne
   * depend d'aucun appel reseau. Un echec ici ne doit donc pas faire echouer
   * l'annulation, qui, elle, a bien eu lieu.
   */
  expirer(referenceExterne: string): Promise<void>;

  /**
   * Authentifie une notification et en rend l'état **faisant foi**.
   *
   * Asynchrone à dessein. Tous les prestataires ne signent pas leur corps :
   * quand l'authentification ne repose que sur un secret partagé en en-tête,
   * celui-ci prouve seulement que l'appelant le connaît — pas que *ce
   * corps-là* vient bien du prestataire. L'adaptateur doit alors reposer la
   * question au prestataire, ce qui suppose un appel réseau.
   *
   * Le corps **brut** reste exigé : là où la signature porte sur les octets,
   * désérialiser puis resérialiser réordonne les clés et l'invalide.
   */
  interpreterWebhook(
    corpsBrut: Buffer,
    entetes: EntetesWebhook,
  ): Promise<EvenementPaiement>;
}

/**
 * En-têtes utiles à l'authentification d'une notification.
 *
 * Passés en bloc plutôt qu'un par un : chaque prestataire nomme le sien, et
 * le contrôleur n'a pas à connaître celui du moment.
 */
export type EntetesWebhook = Record<string, string | string[] | undefined>;

export interface DemandePaiement {
  reference: string;
  /** En FCFA. Entier : le franc CFA n'a pas de subdivision. */
  montant: number;
  methode: MethodePaiement;
  /** Format international, ex. +237699000000. */
  telephone: string;
  description: string;
}

export interface ResultatPaiement {
  reference: string;
  /** Identifiant côté prestataire, à conserver pour la réconciliation. */
  referenceExterne: string;
  statut: StatutPaiement;
  /** Page de confirmation à ouvrir côté client, quand le prestataire en impose une. */
  urlRedirection: string | null;
}

export interface EvenementPaiement {
  reference: string;
  referenceExterne: string;
  statut: StatutPaiement;
}

/**
 * Jeton d'injection.
 *
 * Une interface TypeScript disparaît à la compilation : elle ne peut pas
 * servir de clé à Nest, d'où ce symbole.
 */
export const PASSERELLE_PAIEMENT = Symbol('PasserellePaiement');
