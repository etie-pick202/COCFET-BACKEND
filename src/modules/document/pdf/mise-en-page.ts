import { Logger } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { CharteFigee } from '../entities/contenu-document';

const logger = new Logger('MiseEnPagePdf');

/** Dimensions d'une A4, en points. */
export const LARGEUR_PAGE = 595.28;
export const HAUTEUR_PAGE = 841.89;

/** Marge latérale, en points. 48 pt ≈ 17 mm. */
export const MARGE = 48;

/** Largeur utile d'une A4 une fois les marges retirées. */
export const LARGEUR_UTILE = LARGEUR_PAGE - 2 * MARGE;

/** Au-delà, le contenu empiéterait sur le pied de page. */
export const BAS_CONTENU = HAUTEUR_PAGE - 72;

/**
 * U+00A0, construit plutot qu'ecrit : pose tel quel dans le source, il serait
 * indiscernable d'une espace ordinaire pour qui relit le fichier.
 */
const ESPACE_INSECABLE = String.fromCharCode(0xa0);

/** Palette « papeterie » : encre chaude, filets crème. */
export const ENCRE = '#1C1917';
export const ENCRE_DOUCE = '#57524D';
export const ETIQUETTE = '#6B6560';
export const FILET = '#EEEAE2';
export const BORDURE = '#E7E3DA';
export const CREME = '#FAF8F4';

/** Le document en cours de composition. */
export type Page = PDFKit.PDFDocument;

/**
 * Polices du document.
 *
 * Playfair Display pour les titres et les montants, Inter pour le texte —
 * celles du site. Elles sont incrustées quand leurs fichiers accompagnent le
 * build (`pdf/polices`) ; à défaut, les polices de base du PDF prennent le
 * relais (Times pour les titres, Helvetica pour le texte), qui couvrent les
 * accents français. Un fichier manquant ne doit jamais empêcher l'émission
 * d'une pièce.
 */
const POLICES_DE_BASE = {
  titre: 'Times-Bold',
  texte: 'Helvetica',
  texteMoyen: 'Helvetica',
  texteGras: 'Helvetica-Bold',
  code: 'Courier-Bold',
};

export const POLICE = { ...POLICES_DE_BASE };

const DOSSIER_POLICES = join(__dirname, 'polices');

const FICHIERS_POLICES: Record<keyof typeof POLICE, string | null> = {
  titre: 'PlayfairDisplay-SemiBold.ttf',
  texte: 'Inter-Regular.ttf',
  texteMoyen: 'Inter-Medium.ttf',
  texteGras: 'Inter-SemiBold.ttf',
  code: null,
};

/** Enregistre les polices incrustées disponibles sur le document. */
function enregistrerPolices(page: Page): void {
  // Repart des polices de base : un enregistrement réussi pour un document
  // précédent ne vaut pas pour celui-ci.
  Object.assign(POLICE, POLICES_DE_BASE);
  for (const [role, fichier] of Object.entries(FICHIERS_POLICES) as [
    keyof typeof POLICE,
    string | null,
  ][]) {
    if (!fichier) {
      continue;
    }
    const chemin = join(DOSSIER_POLICES, fichier);
    if (!existsSync(chemin)) {
      continue;
    }
    try {
      page.registerFont(role, chemin);
      POLICE[role] = role;
    } catch (erreur) {
      logger.warn(
        `Police ${fichier} illisible, repli sur la police de base : ${
          erreur instanceof Error ? erreur.message : String(erreur)
        }`,
      );
    }
  }
}

/**
 * Montant en FCFA, groupé par milliers.
 *
 * Espaces insécables : un montant coupé en fin de ligne se lirait comme deux
 * nombres. Aucune décimale — le franc CFA n'a pas de sous-unité.
 */
export function montant(valeur: number, avecDevise = true): string {
  const chiffres = Math.abs(Math.round(valeur)).toString();
  const groupes: string[] = [];

  // Decoupe par tranches plutot que par expression reguliere : le motif a
  // base d'assertions avant a un temps d'execution qui explose sur une
  // entree construite pour ca.
  for (let fin = chiffres.length; fin > 0; fin -= 3) {
    groupes.unshift(chiffres.slice(Math.max(0, fin - 3), fin));
  }

  const signe = valeur < 0 ? '-' : '';
  const nombre = `${signe}${groupes.join(ESPACE_INSECABLE)}`;

  return avecDevise ? `${nombre}${ESPACE_INSECABLE}FCFA` : nombre;
}

/** Morceaux d'une date, lus dans le fuseau des événements. */
function morceaux(iso: string): { jour: string; mois: string; annee: string } {
  const parties = new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Africa/Douala',
  }).formatToParts(new Date(iso));
  const lire = (type: string): string =>
    parties.find((partie) => partie.type === type)?.value ?? '';
  const jour = lire('day');

  // « 1er octobre », et non « 1 octobre » : c'est ainsi qu'une date s'écrit
  // en français, et une pièce comptable se lit de près.
  return {
    jour: jour === '1' ? '1er' : jour,
    mois: lire('month'),
    annee: lire('year'),
  };
}

/** Date en toutes lettres, telle qu'elle doit se lire sur une pièce. */
export function dateLisible(iso: string): string {
  const { jour, mois, annee } = morceaux(iso);
  return `${jour} ${mois} ${annee}`;
}

/**
 * Période en toutes lettres, sans répéter ce que les deux bornes partagent :
 * « 1er – 30 septembre 2026 », « 15 août – 14 septembre 2026 ».
 */
export function periodeLisible(depuis: string, jusqua: string): string {
  const debut = morceaux(depuis);
  const fin = morceaux(jusqua);

  if (debut.annee !== fin.annee) {
    return `${dateLisible(depuis)} – ${dateLisible(jusqua)}`;
  }
  if (debut.mois !== fin.mois) {
    return `${debut.jour} ${debut.mois} – ${dateLisible(jusqua)}`;
  }
  if (debut.jour !== fin.jour) {
    return `${debut.jour} – ${dateLisible(jusqua)}`;
  }
  return dateLisible(depuis);
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
    margins: { top: 48, bottom: 0, left: MARGE, right: MARGE },
    bufferPages: true,
  });
  const morceaux: Buffer[] = [];

  page.on('data', (morceau: Buffer) => morceaux.push(morceau));

  const termine = new Promise<Buffer>((resoudre, rejeter) => {
    page.on('end', () => resoudre(Buffer.concat(morceaux)));
    page.on('error', rejeter);
  });

  enregistrerPolices(page);
  page.on('pageAdded', () => bandeau(page, couleurBandeau));

  return { page, termine };
}

/** Couleur du filet de tête, reprise sur chaque nouvelle page. */
let couleurBandeau = '#0F172A';

function bandeau(page: Page, couleur: string): void {
  page.save().rect(0, 0, LARGEUR_PAGE, 3.75).fill(couleur).restore();
  page.y = 48;
}

/** Passe à la page suivante si `hauteur` ne tient plus sur celle-ci. */
export function reserver(page: Page, hauteur: number): void {
  if (page.y + hauteur > BAS_CONTENU) {
    page.addPage();
  }
}

/** Petite capitale espacée, au-dessus d'une valeur. */
export function etiquette(
  page: Page,
  texte: string,
  x: number,
  y: number,
  options: { largeur?: number; couleur?: string; aDroite?: boolean } = {},
): void {
  page
    .font(POLICE.texteGras)
    .fontSize(7)
    .fillColor(options.couleur ?? ETIQUETTE)
    .text(texte.toUpperCase(), x, y, {
      width: options.largeur,
      characterSpacing: 1.3,
      align: options.aDroite ? 'right' : 'left',
      lineBreak: options.largeur !== undefined,
    });
}

/**
 * En-tête de la pièce : identité du mandat à gauche, nature et numéro à
 * droite, filet doré dessous.
 *
 * Le logo est incrusté quand il est lisible. À défaut, un monogramme — l'
 * initiale du mandat dans un cadre doré — tient sa place, pour que l'en-tête
 * garde son équilibre.
 */
export function enTete(
  page: Page,
  charte: CharteFigee,
  logo: Buffer | null,
  intitule: string,
  numero: string,
  sousNumero: string | null,
): void {
  couleurBandeau = charte.couleurPrimaire;
  bandeau(page, charte.couleurPrimaire);

  const haut = 39;
  const cote = 39;
  let logoPose = false;

  if (logo) {
    try {
      page.image(logo, MARGE, haut, {
        fit: [cote, cote],
        align: 'center',
        valign: 'center',
      });
      logoPose = true;
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

  if (!logoPose) {
    page
      .roundedRect(MARGE + 0.4, haut + 0.4, cote - 0.8, cote - 0.8, 6)
      .lineWidth(0.8)
      .strokeColor(charte.couleurSecondaire)
      .stroke();
    page
      .font(POLICE.titre)
      .fontSize(19)
      .fillColor(charte.couleurPrimaire)
      .text(charte.nom.trim().charAt(0).toUpperCase(), MARGE, haut + 9, {
        width: cote,
        align: 'center',
        lineBreak: false,
      });
  }

  const xIdentite = MARGE + cote + 11;
  page
    .font(POLICE.titre)
    .fontSize(15)
    .fillColor(charte.couleurPrimaire)
    .text(charte.nom.toUpperCase(), xIdentite, haut + 2, {
      characterSpacing: 1.5,
      lineBreak: false,
    });
  page
    .font(POLICE.texte)
    .fontSize(7.5)
    .fillColor(ENCRE_DOUCE)
    .text(
      'Comité d’Organisation de la Cérémonie de Fin d’Étude',
      xIdentite,
      haut + 22,
      { lineBreak: false },
    )
    .text(
      charte.annee === null
        ? 'L’institut Ucac-Icam'
        : `L’institut Ucac-Icam · Promotion ${charte.annee}`,
      xIdentite,
      haut + 31,
      { lineBreak: false },
    );

  const largeurDroite = 220;
  const xDroite = MARGE + LARGEUR_UTILE - largeurDroite;
  page.font(POLICE.titre).fontSize(intitule.length > 12 ? 22.5 : 25.5);
  const hauteurIntitule = page.heightOfString(intitule, {
    width: largeurDroite,
  });
  page.fillColor(ENCRE).text(intitule, xDroite, haut, {
    width: largeurDroite,
    align: 'right',
    lineGap: -2,
  });
  let y = haut + hauteurIntitule + 6;
  page
    .font(POLICE.texteMoyen)
    .fontSize(8.25)
    .fillColor(ENCRE_DOUCE)
    .text(`N° ${numero}`, xDroite, y, {
      width: largeurDroite,
      align: 'right',
      characterSpacing: 0.3,
    });
  if (sousNumero) {
    y += 11;
    page
      .font(POLICE.texte)
      .text(sousNumero, xDroite, y, { width: largeurDroite, align: 'right' });
  }

  const filet = Math.max(haut + cote, y + 10) + 19;
  page
    .moveTo(MARGE, filet)
    .lineTo(MARGE + LARGEUR_UTILE, filet)
    .lineWidth(0.75)
    .strokeColor(charte.couleurSecondaire)
    .stroke();

  page.y = filet + 22;
}

/** Une cellule d'information : étiquette, puis valeur et détail éventuel. */
export interface Information {
  cle: string;
  valeur: string;
  detail?: string;
  /** Rendu propre à la valeur, à la place du texte (pastille de statut…). */
  dessiner?: (page: Page, x: number, y: number, largeur: number) => number;
}

/** Rangée d'informations en colonnes égales. Rend la hauteur occupée. */
export function informations(
  page: Page,
  cellules: Information[],
  options: { tailleValeur?: number; ecart?: number } = {},
): void {
  const ecart = options.ecart ?? 24;
  const largeur =
    (LARGEUR_UTILE - ecart * (cellules.length - 1)) / cellules.length;
  const haut = page.y;
  let bas = haut;

  cellules.forEach((cellule, index) => {
    const x = MARGE + index * (largeur + ecart);
    etiquette(page, cellule.cle, x, haut, { largeur });
    let y = haut + 13;

    if (cellule.dessiner) {
      y += cellule.dessiner(page, x, y, largeur);
    } else {
      page
        .font(POLICE.texteGras)
        .fontSize(options.tailleValeur ?? 10.5)
        .fillColor(ENCRE)
        .text(cellule.valeur, x, y, { width: largeur });
      y = page.y;
    }

    if (cellule.detail) {
      page
        .font(POLICE.texte)
        .fontSize(9)
        .fillColor(ENCRE_DOUCE)
        .text(cellule.detail, x, y + 1.5, { width: largeur });
      y = page.y;
    }
    bas = Math.max(bas, y);
  });

  page.y = bas;
}

/** Titre de section, en petites capitales. */
export function section(page: Page, titre: string, avant = 22): void {
  reserver(page, avant + 60);
  page.y += avant;
  etiquette(page, titre, MARGE, page.y, {
    largeur: LARGEUR_UTILE,
    couleur: ENCRE_DOUCE,
  });
  page.y += 7.5;
}

export interface ColonneTableau {
  titre: string;
  /** Part de la largeur utile, entre 0 et 1. La somme doit valoir 1. */
  part: number;
  aDroite?: boolean;
}

/** Contenu d'une cellule : du texte, ou un dessin libre (barre de part…). */
export type Cellule =
  | string
  | {
      texte: string;
      detail?: string;
      dessiner?: (page: Page, x: number, y: number, largeur: number) => void;
    };

/**
 * Tableau à en-tête souligné et filets fins.
 *
 * Les hauteurs de ligne sont mesurées avant d'écrire : une désignation longue
 * passe sur deux lignes, et sans cette mesure la ligne suivante viendrait
 * s'écrire par-dessus. Une ligne qui ne tient plus ouvre une page, et l'en-tête
 * des colonnes y est reposé.
 */
export function tableau(
  page: Page,
  colonnes: ColonneTableau[],
  lignes: Cellule[][],
  options: { taille?: number; interligne?: number } = {},
): void {
  const taille = options.taille ?? 9.75;
  const interligne = options.interligne ?? 9.5;
  const ecart = 9;
  const largeurs = colonnes.map(
    (colonne, index) =>
      colonne.part * LARGEUR_UTILE - (index < colonnes.length - 1 ? ecart : 0),
  );
  const x = (index: number): number =>
    MARGE +
    colonnes
      .slice(0, index)
      .reduce((somme, colonne) => somme + colonne.part * LARGEUR_UTILE, 0);

  const entete = (): void => {
    const haut = page.y;
    colonnes.forEach((colonne, index) => {
      etiquette(page, colonne.titre, x(index), haut, {
        largeur: largeurs[index],
        aDroite: colonne.aDroite,
      });
    });
    const filet = haut + 13;
    page
      .moveTo(MARGE, filet)
      .lineTo(MARGE + LARGEUR_UTILE, filet)
      .lineWidth(1.1)
      .strokeColor(ENCRE)
      .stroke();
    page.y = filet;
  };

  const mesurer = (cellule: Cellule, index: number): number => {
    const texte = typeof cellule === 'string' ? cellule : cellule.texte;
    page.font(POLICE.texte).fontSize(taille);
    let hauteur = page.heightOfString(texte || ' ', {
      width: largeurs[index],
    });
    if (typeof cellule !== 'string' && cellule.detail) {
      page.fontSize(8.25);
      hauteur +=
        2 + page.heightOfString(cellule.detail, { width: largeurs[index] });
    }
    return hauteur;
  };

  entete();

  lignes.forEach((ligne) => {
    const hauteur = Math.max(...ligne.map(mesurer));

    if (page.y + hauteur + 2 * interligne > BAS_CONTENU) {
      page.addPage();
      entete();
    }

    const haut = page.y + interligne;

    ligne.forEach((cellule, index) => {
      const colonne = colonnes[index];
      if (typeof cellule !== 'string' && cellule.dessiner) {
        cellule.dessiner(page, x(index), haut, largeurs[index]);
        return;
      }
      const texte = typeof cellule === 'string' ? cellule : cellule.texte;
      page
        .font(index === 0 ? POLICE.texteMoyen : POLICE.texte)
        .fontSize(taille)
        .fillColor(ENCRE)
        .text(texte, x(index), haut, {
          width: largeurs[index],
          align: colonne.aDroite ? 'right' : 'left',
        });
      if (typeof cellule !== 'string' && cellule.detail) {
        page
          .font(POLICE.texte)
          .fontSize(8.25)
          .fillColor(ETIQUETTE)
          .text(cellule.detail, x(index), page.y + 2, {
            width: largeurs[index],
            align: colonne.aDroite ? 'right' : 'left',
          });
      }
    });

    const filet = haut + hauteur + interligne;
    page
      .moveTo(MARGE, filet)
      .lineTo(MARGE + LARGEUR_UTILE, filet)
      .lineWidth(0.75)
      .strokeColor(FILET)
      .stroke();
    page.y = filet;
  });
}

/** Ligne d'un bloc de totaux. */
export interface LigneTotal {
  libelle: string;
  valeur: string;
}

/**
 * Bloc de totaux aligné à droite : les lignes de détail, puis le montant
 * final sous un filet aux couleurs du mandat, en grand.
 */
export function totaux(
  page: Page,
  charte: CharteFigee,
  lignes: LigneTotal[],
  final: LigneTotal,
  options: { largeur?: number; avant?: number } = {},
): { haut: number; bas: number } {
  const largeur = options.largeur ?? 225;
  const x = MARGE + LARGEUR_UTILE - largeur;
  reserver(page, (options.avant ?? 15) + lignes.length * 15 + 40);
  const haut = page.y + (options.avant ?? 15);
  let y = haut;

  lignes.forEach((ligne) => {
    page
      .font(POLICE.texte)
      .fontSize(9.4)
      .fillColor(ENCRE_DOUCE)
      .text(ligne.libelle, x, y, { width: largeur, lineBreak: false })
      .fillColor(ENCRE)
      .text(ligne.valeur, x, y, {
        width: largeur,
        align: 'right',
        lineBreak: false,
      });
    y += 15;
  });

  y += 4;
  page
    .moveTo(x, y)
    .lineTo(x + largeur, y)
    .lineWidth(1.1)
    .strokeColor(charte.couleurPrimaire)
    .stroke();
  y += 9;

  page
    .font(POLICE.texteGras)
    .fontSize(9)
    .fillColor(ENCRE)
    .text(final.libelle, x, y + 5, { width: largeur, lineBreak: false });
  page
    .font(POLICE.titre)
    .fontSize(16.5)
    .fillColor(charte.couleurPrimaire)
    .text(final.valeur, x, y, {
      width: largeur,
      align: 'right',
      lineBreak: false,
    });

  page.y = y + 24;
  return { haut, bas: page.y };
}

/** Encadré crème pour une mention : conditions, portée de la pièce. */
export function mention(page: Page, texte: string, avant = 36): void {
  page.font(POLICE.texte).fontSize(7.9);
  const largeur = LARGEUR_UTILE - 27;
  const hauteur = page.heightOfString(texte, { width: largeur, lineGap: 2 });
  reserver(page, avant + hauteur + 21);
  const haut = page.y + avant;

  page.roundedRect(MARGE, haut, LARGEUR_UTILE, hauteur + 21, 4.5).fill(CREME);
  page
    .fillColor(ENCRE_DOUCE)
    .text(texte, MARGE + 13.5, haut + 10.5, { width: largeur, lineGap: 2 });

  page.y = haut + hauteur + 21;
}

/**
 * Pied de page, posé sur chaque page existante : rappel de la pièce à gauche,
 * pagination à droite.
 *
 * Appelé en dernier : PDFKit n'ajoute pas de page rétroactivement, et il faut
 * les connaître toutes pour numéroter « 1 / 3 ».
 */
export function pied(page: Page, rappel: string): void {
  const pages = page.bufferedPageRange();
  const y = HAUTEUR_PAGE - 27 - 14;

  for (let index = 0; index < pages.count; index += 1) {
    page.switchToPage(pages.start + index);
    page
      .moveTo(MARGE, y)
      .lineTo(MARGE + LARGEUR_UTILE, y)
      .lineWidth(0.75)
      .strokeColor(BORDURE)
      .stroke();
    page
      .font(POLICE.texte)
      .fontSize(6.75)
      .fillColor(ETIQUETTE)
      .text(rappel, MARGE, y + 7.5, {
        width: LARGEUR_UTILE - 80,
        lineBreak: false,
      })
      .text(`Page ${index + 1} / ${pages.count}`, MARGE, y + 7.5, {
        width: LARGEUR_UTILE,
        align: 'right',
        lineBreak: false,
      });
  }
}
