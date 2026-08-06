import { MethodePaiement, StatutPaiement } from '../enums/paiement.enum';

/**
 * Contrat que doit respecter tout prestataire de paiement mobile.
 *
 * La billetterie et la boutique ne connaissent que cette interface. Le compte
 * NotchPay n'étant pas encore ouvert, l'implémentation réelle viendra plus
 * tard sans qu'aucun appelant n'ait à changer.
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
   * Valide la signature d'un webhook et en extrait l'état du paiement.
   *
   * Lève si la signature est absente ou fausse. Le corps **brut** est exigé :
   * un corps déjà désérialisé puis resérialisé ne produit plus la même
   * signature.
   */
  interpreterWebhook(corpsBrut: Buffer, signature?: string): EvenementPaiement;
}

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
