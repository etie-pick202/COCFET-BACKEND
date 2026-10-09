export enum MethodePaiement {
  ORANGE_MONEY = 'ORANGE_MONEY',
  MTN_MOMO = 'MTN_MOMO',
}

/** Issue d'un retrait du solde vers un compte Mobile Money. */
export enum StatutRetrait {
  EN_COURS = 'EN_COURS',
  REUSSI = 'REUSSI',
  ECHOUE = 'ECHOUE',
}

/**
 * D'où vient une ligne du journal des sorties.
 *
 * `FAPSHI` : un retrait relevé chez Fapshi, avec son détail. `CONSTATEE` : une
 * baisse du solde que rien n'explique, constatée par l'application — c'est le
 * cas d'un transfert du service vers le compte principal de Fapshi, suivi d'un
 * retrait, qui se font dans un espace que l'API du service ne montre pas.
 */
export enum SourceRetrait {
  FAPSHI = 'FAPSHI',
  CONSTATEE = 'CONSTATEE',
}

export enum StatutPaiement {
  EN_ATTENTE = 'EN_ATTENTE',
  COMPLETE = 'COMPLETE',
  ECHOUE = 'ECHOUE',
}

/**
 * Par où l'argent est arrivé.
 *
 * Distinct de l'opérateur (`MethodePaiement`), que la page de paiement Fapshi
 * ne nous rend pas toujours : le canal, lui, est toujours connu.
 */
export enum CanalPaiement {
  /** Payé sur la plateforme, par Fapshi. */
  EN_LIGNE = 'EN_LIGNE',
  /** Remis hors plateforme, sur preuve validée par la trésorerie. */
  HORS_LIGNE = 'HORS_LIGNE',
  /** Rien à payer : un événement gratuit, par exemple. */
  GRATUIT = 'GRATUIT',
}
