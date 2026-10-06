/** Espace insécable : un montant coupé en fin de ligne se lirait comme deux nombres. */
const INSECABLE = String.fromCharCode(0xa0);

/**
 * Un montant en francs CFA, tel qu'il se lit dans un message : « 25 000 FCFA ».
 */
export function montantLisible(montant: number): string {
  const groupes = montant.toLocaleString('fr-FR').replace(/\s/g, INSECABLE);
  return `${groupes}${INSECABLE}FCFA`;
}
