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
  total: number;
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
  prix: number;
  methodePaiement: string | null;
}

export interface LigneVentilation {
  libelle: string;
  montant: number;
  nombre: number;
}

export interface ContenuRapport extends ContenuCommun {
  genre: 'RAPPORT_TRESORERIE';
  /** Bornes demandées, en ISO. Nulles quand le rapport porte sur tout. */
  depuis: string | null;
  jusqua: string | null;
  recettesTotales: number;
  transactionsAbouties: number;
  transactionsEnAttente: number;
  transactionsEchouees: number;
  panierMoyen: number;
  parOrigine: LigneVentilation[];
  parMethode: LigneVentilation[];
  /** Émetteur du rapport : un chiffre engage celui qui le sort. */
  emisPar: string;
}

export type ContenuDocument = ContenuFacture | ContenuRecu | ContenuRapport;
