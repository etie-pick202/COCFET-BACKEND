/**
 * Sérialisation CSV, écrite ici plutôt que tirée d'une bibliothèque.
 *
 * Le besoin tient en une fonction : quelques colonnes, aucun type exotique.
 * Une dépendance de plus serait à suivre, à auditer et à mettre à jour pour
 * ce que fait ce fichier.
 */

/** Séparateur. Le point-virgule est ce qu'attend Excel en locale française. */
const SEPARATEUR = ';';

/**
 * Marque d'ordre des octets, en séquence d'échappement.
 *
 * Sans elle, Excel lit le fichier en ANSI et transforme chaque accent en
 * caractère de remplacement : « Événement » devient « Ã‰vÃ©nement ». Notée en
 * séquence d'échappement et non collée telle quelle — un caractère invisible
 * dans le code source se perd au premier copier-coller, et personne ne
 * comprend alors pourquoi les accents sont cassés.
 */
const BOM = '﻿';

/**
 * Ce qu'une cellule peut contenir.
 *
 * Volontairement restreint : accepter `unknown` laisserait passer un objet,
 * qui se sérialiserait en « [object Object] » sans que rien ne prévienne.
 */
export type ValeurCsv = string | number | boolean | null | undefined;

/**
 * Échappe une valeur selon RFC 4180.
 *
 * Le guillemet double à l'intérieur d'un champ se double, et tout champ
 * contenant séparateur, guillemet ou saut de ligne est encadré. Sans cela, un
 * nom d'événement contenant un point-virgule décalerait toutes les colonnes
 * suivantes — et le tableur afficherait des montants dans la colonne date.
 */
function echapper(valeur: ValeurCsv): string {
  if (valeur === null || valeur === undefined) {
    return '';
  }

  const texte = String(valeur);

  return /[";\n\r]/.test(texte) ? `"${texte.split('"').join('""')}"` : texte;
}

/**
 * Assemble un CSV à partir d'en-têtes et de lignes.
 *
 * Les sauts de ligne sont en CRLF, ce qu'impose la RFC et ce que réclament
 * les tableurs sous Windows.
 */
export function versCsv(entetes: string[], lignes: ValeurCsv[][]): string {
  const contenu = [entetes, ...lignes]
    .map((ligne) => ligne.map(echapper).join(SEPARATEUR))
    .join('\r\n');

  return `${BOM}${contenu}`;
}
