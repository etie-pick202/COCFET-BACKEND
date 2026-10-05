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

export enum StatutPaiement {
  EN_ATTENTE = 'EN_ATTENTE',
  COMPLETE = 'COMPLETE',
  ECHOUE = 'ECHOUE',
}
