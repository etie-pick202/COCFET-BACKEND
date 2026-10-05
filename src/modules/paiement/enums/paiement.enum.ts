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
