import { versCsv } from './export-csv';

/** Même séquence que la source : un BOM collé se perd au copier-coller. */
const BOM = '﻿';

/** Retire le BOM pour comparer le contenu lui-même. */
const sansBom = (csv: string) => (csv.startsWith(BOM) ? csv.slice(1) : csv);

describe('versCsv', () => {
  it('assemble en-têtes et lignes, séparés par des points-virgules', () => {
    const csv = sansBom(versCsv(['Date', 'Montant'], [['2027-08-12', 5000]]));

    expect(csv).toBe('Date;Montant\r\n2027-08-12;5000');
  });

  it('encadre un champ contenant le séparateur', () => {
    // Sans cela, un titre d'événement à point-virgule décalerait toutes les
    // colonnes suivantes — les montants atterriraient dans la colonne date.
    const csv = sansBom(versCsv(['Titre'], [['Gala ; soirée']]));

    expect(csv).toBe('Titre\r\n"Gala ; soirée"');
  });

  it('double les guillemets à l’intérieur d’un champ', () => {
    const csv = sansBom(versCsv(['Titre'], [['Soirée "blanche"']]));

    expect(csv).toBe('Titre\r\n"Soirée ""blanche"""');
  });

  it('encadre un champ contenant un saut de ligne', () => {
    const csv = sansBom(versCsv(['Note'], [['ligne un\nligne deux']]));

    expect(csv).toBe('Note\r\n"ligne un\nligne deux"');
  });

  it('rend une cellule vide pour une valeur absente', () => {
    // `null` traverse jusqu'ici : une transaction sans compte rattaché, ou
    // sans référence prestataire. « null » écrit en toutes lettres dans un
    // tableur se lirait comme une valeur.
    const csv = sansBom(versCsv(['A', 'B'], [[null, undefined]]));

    expect(csv).toBe('A;B\r\n;');
  });

  it('commence par un BOM UTF-8', () => {
    // Sans lui, Excel lit en ANSI : « Événement » devient « Ã‰vÃ©nement ».
    expect(versCsv(['Événement'], []).startsWith(BOM)).toBe(true);
  });

  it('accepte un export sans aucune ligne', () => {
    expect(sansBom(versCsv(['Date', 'Montant'], []))).toBe('Date;Montant');
  });
});
