import { Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { CharteFigee } from '../entities/contenu-document';

const logger = new Logger('MiseEnPagePdf');

/** Marge de page, en points. 48 pt ≈ 17 mm. */
export const MARGE = 48;

/** Largeur utile d'une A4 une fois les marges retirées. */
export const LARGEUR_UTILE = 595.28 - 2 * MARGE;

const HAUTEUR_BANDEAU = 88;

/**
 * U+00A0, construit plutot qu'ecrit : pose tel quel dans le source, il serait
 * indiscernable d'une espace ordinaire pour qui relit le fichier.
 */
const ESPACE_INSECABLE = String.fromCharCode(0xa0);

const GRIS_TEXTE = '#1F2937';
const GRIS_DISCRET = '#6B7280';
const GRIS_FILET = '#E5E7EB';

/** Le document en cours de composition. */
export type Page = PDFKit.PDFDocument;

/**
 * Montant en FCFA, groupé par milliers.
 *
 * Espaces insécables : un montant coupé en fin de ligne se lirait comme deux
 * nombres. Aucune décimale — le franc CFA n'a pas de sous-unité.
 */
export function montant(valeur: number): string {
  const chiffres = Math.abs(Math.round(valeur)).toString();
  const groupes: string[] = [];

  // Decoupe par tranches plutot que par expression reguliere : le motif a
  // base d'assertions avant a un temps d'execution qui explose sur une
  // entree construite pour ca.
  for (let fin = chiffres.length; fin > 0; fin -= 3) {
    groupes.unshift(chiffres.slice(Math.max(0, fin - 3), fin));
  }

  const signe = valeur < 0 ? '-' : '';

  return `${signe}${groupes.join(ESPACE_INSECABLE)}${ESPACE_INSECABLE}FCFA`;
}

/** Date en toutes lettres, telle qu'elle doit se lire sur une pièce. */
export function dateLisible(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Ouvre une page A4 et rend de quoi la composer.
 *
 * `bufferPages` retient les pages jusqu'à la fermeture : c'est ce qui permet
 * d'y revenir pour numéroter « 1 / 3 », un total qu'on ignore tant que le
 * contenu n'est pas posé.
 */
export function ouvrir(): { page: Page; termine: Promise<Buffer> } {
  const page = new PDFDocument({
    size: 'A4',
    margin: MARGE,
    bufferPages: true,
  });
  const morceaux: Buffer[] = [];

  page.on('data', (morceau: Buffer) => morceaux.push(morceau));

  const termine = new Promise<Buffer>((resoudre, rejeter) => {
    page.on('end', () => resoudre(Buffer.concat(morceaux)));
    page.on('error', rejeter);
  });

  return { page, termine };
}

/**
 * Bandeau d'en-tête aux couleurs du mandat.
 *
 * Le logo est incrusté quand il est lisible. Contrairement à l'email, un PDF
 * porte réellement ses images : c'est ici que les octets rendus par le service
 * d'identité visuelle servent enfin.
 */
export function enTete(
  page: Page,
  charte: CharteFigee,
  logo: Buffer | null,
  intitule: string,
  numero: string,
): void {
  page.rect(0, 0, 595.28, HAUTEUR_BANDEAU).fill(charte.couleurPrimaire);
  page.rect(0, HAUTEUR_BANDEAU, 595.28, 4).fill(charte.couleurSecondaire);

  let x = MARGE;

  if (logo) {
    try {
      page.image(logo, MARGE, 20, { fit: [48, 48] });
      x += 62;
    } catch (erreur) {
      // Le logo peut être un SVG ou un WebP, que PDFKit ne sait pas poser. Un
      // document sans logo reste une pièce valable ; un document jamais émis,
      // non.
      logger.warn(
        `Logo illisible pour le PDF, document composé sans image : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
    }
  }

  page
    .fillColor(charte.contrastePrimaire)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(charte.nom, x, 28, { lineBreak: false });

  if (charte.annee !== null) {
    page
      .font('Helvetica')
      .fontSize(10)
      .text(`Mandat ${charte.annee}`, x, 50, { lineBreak: false });
  }

  page
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(intitule, MARGE, 28, {
      width: LARGEUR_UTILE,
      align: 'right',
      lineBreak: false,
    })
    .font('Helvetica')
    .fontSize(10)
    .text(numero, MARGE, 48, {
      width: LARGEUR_UTILE,
      align: 'right',
      lineBreak: false,
    });

  page.fillColor(GRIS_TEXTE).font('Helvetica').fontSize(10);
  page.y = HAUTEUR_BANDEAU + 32;
}

/** Titre de section, précédé d'un peu d'air. */
export function section(page: Page, titre: string): void {
  page
    .moveDown(1)
    .fillColor(GRIS_DISCRET)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text(titre.toUpperCase(), MARGE, page.y, { characterSpacing: 0.6 })
    .fillColor(GRIS_TEXTE)
    .font('Helvetica')
    .fontSize(10)
    .moveDown(0.5);
}

/** Couple libellé / valeur, alignés en deux colonnes. */
export function ligneCle(page: Page, cle: string, valeur: string): void {
  const y = page.y;

  page
    .fillColor(GRIS_DISCRET)
    .text(cle, MARGE, y, { width: 160, lineBreak: false })
    .fillColor(GRIS_TEXTE)
    .font('Helvetica-Bold')
    .text(valeur, MARGE + 160, y, { width: LARGEUR_UTILE - 160 })
    .font('Helvetica');
}

export interface ColonneTableau {
  titre: string;
  /** Part de la largeur utile, entre 0 et 1. La somme doit valoir 1. */
  part: number;
  aDroite?: boolean;
}

/**
 * Tableau à en-tête et filets.
 *
 * Les hauteurs de ligne sont mesurées avant d'écrire : une désignation longue
 * passe sur deux lignes, et sans cette mesure la ligne suivante viendrait
 * s'écrire par-dessus.
 */
export function tableau(
  page: Page,
  colonnes: ColonneTableau[],
  lignes: string[][],
): void {
  const largeurs = colonnes.map((colonne) => colonne.part * LARGEUR_UTILE);
  const x = (index: number): number =>
    MARGE + largeurs.slice(0, index).reduce((somme, l) => somme + l, 0);

  const ecrire = (valeurs: string[], gras: boolean): void => {
    const depart = page.y;
    page.font(gras ? 'Helvetica-Bold' : 'Helvetica');

    const hauteur = Math.max(
      ...valeurs.map((valeur, index) =>
        page.heightOfString(valeur, { width: largeurs[index] - 8 }),
      ),
    );

    // Une page A4 tient environ 700 pt de contenu : au-delà, la ligne suivante
    // s'écrirait dans le pied de page.
    if (depart + hauteur > 780) {
      page.addPage();
    }

    const haut = page.y;

    valeurs.forEach((valeur, index) => {
      page.text(valeur, x(index), haut, {
        width: largeurs[index] - 8,
        align: colonnes[index].aDroite ? 'right' : 'left',
      });
    });

    page.y = haut + hauteur + 6;
  };

  page.fillColor(GRIS_DISCRET).fontSize(9);
  ecrire(
    colonnes.map((colonne) => colonne.titre.toUpperCase()),
    true,
  );

  page
    .moveTo(MARGE, page.y - 3)
    .lineTo(MARGE + LARGEUR_UTILE, page.y - 3)
    .strokeColor(GRIS_FILET)
    .stroke();

  page.fillColor(GRIS_TEXTE).fontSize(10);
  lignes.forEach((ligne) => ecrire(ligne, false));
}

/** Total mis en évidence, aligné à droite sous un tableau. */
export function total(page: Page, libelle: string, valeur: string): void {
  page
    .moveTo(MARGE, page.y + 2)
    .lineTo(MARGE + LARGEUR_UTILE, page.y + 2)
    .strokeColor(GRIS_FILET)
    .stroke();

  page
    .moveDown(0.6)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text(`${libelle} : ${valeur}`, MARGE, page.y, {
      width: LARGEUR_UTILE,
      align: 'right',
    })
    .font('Helvetica')
    .fontSize(10);
}

/**
 * Pied de page, posé sur chaque page existante.
 *
 * Appelé en dernier : PDFKit n'ajoute pas de page rétroactivement, et il faut
 * les connaître toutes pour numéroter « 1 / 3 ».
 */
export function pied(page: Page, mention: string): void {
  const pages = page.bufferedPageRange();

  for (let index = 0; index < pages.count; index += 1) {
    page.switchToPage(pages.start + index);
    page
      .fillColor(GRIS_DISCRET)
      .font('Helvetica')
      .fontSize(8)
      .text(
        `${mention}    -    page ${index + 1} / ${pages.count}`,
        MARGE,
        790,
        { width: LARGEUR_UTILE, align: 'center', lineBreak: false },
      );
  }
}
