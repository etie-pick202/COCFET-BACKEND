/**
 * Ce qu'un document conserve pour pouvoir être redessiné.
 *
 * Ces formes vivent en `jsonb`, pas en tables : elles ne sont jamais requêtées
 * ni jointes, seulement relues en entier pour produire un PDF. Les normaliser
 * créerait des tables miroir de la boutique et de la billetterie, qui
 * évolueraient avec elles — soit exactement ce qu'on veut éviter, puisque le
 * document doit rester figé quand le domaine bouge.
 */

/**
 * Charte du mandat au moment de l'émission.
 *
 * Recopiée plutôt que relue : une facture émise sous un mandat ne doit pas
 * changer de couleurs à la passation suivante. Le logo est désigné par sa clé
 * et non par ses octets — un `jsonb` n'est pas un entrepôt de fichiers, et le
 * stockage sait le rendre.
 */
export interface CharteFigee {
  nom: string;
  annee: number | null;
  couleurPrimaire: string;
  couleurSecondaire: string;
  contrastePrimaire: string;
  logo: string | null;
}

/** Titulaire de la pièce, tel qu'il doit y figurer. */
export interface TitulaireFige {
  nom: string;
  email: string;
}

interface ContenuCommun {
  charte: CharteFigee;
  /** Date d'émission, en ISO. Portée par le contenu pour rester figée. */
  emisLe: string;
}

export interface LigneFacture {
  designation: string;
  quantite: number;
  /** FCFA, prix unitaire figé à la commande. */
  prixUnitaire: number;
}

export interface ContenuFacture extends ContenuCommun {
  genre: 'FACTURE_COMMANDE';
  titulaire: TitulaireFige;
  lignes: LigneFacture[];
  /** Somme des lignes, avant les frais de paiement. */
  total: number;
  /** Nuls sur une commande antérieure à la répercussion des frais. */
  fraisFapshi: number | null;
  fraisRetrait: number | null;
  /** Ce qui a été réellement réglé — total plus les deux frais ci-dessus. */
  montantTtc: number | null;
  statutPaiement: string;
  methodePaiement: string | null;
}

export interface ContenuRecu extends ContenuCommun {
  genre: 'RECU_BILLETTERIE';
  titulaire: TitulaireFige;
  evenement: string;
  /** Date de l'événement, en ISO. */
  dateEvenement: string;
  lieu: string;
  codeBillet: string;
  /** Prix affiché du billet, avant les frais de paiement. */
  prix: number;
  /** Nuls sur une inscription antérieure à la répercussion des frais. */
  fraisFapshi: number | null;
  fraisRetrait: number | null;
  /** Ce qui a été réellement réglé — prix plus les deux frais ci-dessus. */
  montantTtc: number | null;
  methodePaiement: string | null;
}

/**
 * Facture du règlement d'une échéance de cotisation.
 *
 * Une cotisation se règle en plusieurs fois : chaque règlement abouti a sa
 * facture, qui dit ce qu'il a couvert — « Première tranche », « Tout le reste
 * dû » — et ce qu'il a coûté en frais de paiement.
 */
export interface ContenuFactureCotisation extends ContenuCommun {
  genre: 'FACTURE_COTISATION';
  titulaire: TitulaireFige;
  cotisation: string;
  /** Ce que le règlement couvre : le libellé de l'échéance, figé. */
  echeance: string;
  /** Montant crédité à la cotisation, frais exclus. */
  montant: number;
  /**
   * Frais de paiement en ligne, retenus en plus du montant. Nul pour une
   * preuve validée : l'argent n'est pas passé par le prestataire.
   */
  fraisPaiement: number | null;
  /** Ce qui a été réellement réglé — le montant, plus les frais. */
  montantTtc: number;
  /** `EN_LIGNE` ou `JUSTIFICATIF` : comment l'argent est parvenu au bureau. */
  mode: string;
  /** Référence du règlement, la même que celle de la transaction. */
  reference: string;
  /** Date du règlement, en ISO. */
  recuLe: string;
}

export interface LigneVentilation {
  libelle: string;
  montant: number;
  /** Absent des rapports émis avant la prise en compte des frais. */
  montantNet?: number;
  nombre: number;
}

export interface ContenuRapport extends ContenuCommun {
  genre: 'RAPPORT_TRESORERIE';
  /** Bornes demandées, en ISO. Nulles quand le rapport porte sur tout. */
  depuis: string | null;
  jusqua: string | null;
  /** Montants débités aux payeurs, frais compris. */
  recettesTotales: number;
  /**
   * Frais retenus par le prestataire, et encaissé net. Absents des rapports
   * émis avant leur prise en compte : un rapport figé ne se réécrit pas.
   */
  fraisPrestataire?: number;
  recettesNettes?: number;
  transactionsAbouties: number;
  transactionsEnAttente: number;
  transactionsEchouees: number;
  panierMoyen: number;
  parOrigine: LigneVentilation[];
  parMethode: LigneVentilation[];
  /** Émetteur du rapport : un chiffre engage celui qui le sort. */
  emisPar: string;
}

export type ContenuDocument =
  ContenuFacture | ContenuRecu | ContenuFactureCotisation | ContenuRapport;
