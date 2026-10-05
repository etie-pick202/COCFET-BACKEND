import type { IdentiteVisuelle } from '../generation/identite-visuelle.service';

/**
 * Identifiant du logo dans le message. Le gabarit commun le cite en
 * `src="cid:…"` ; la pièce jointe portant le même identifiant s'affiche alors
 * à cet endroit au lieu de figurer parmi les fichiers joints.
 */
export const CID_LOGO = 'logo@cocfet';

/** Identifiant du QR code d'un billet à code fixe. */
export const CID_QR = 'qr@cocfet';

/**
 * Pièce jointe telle que la remet `MailService`.
 *
 * `cid` place l'image dans le corps du message. `decorative` marque une image
 * qui n'a de sens qu'affichée : si le transport ne sait pas l'incruster — l'API
 * HTTP de Brevo, en repli —, elle est retirée plutôt que livrée comme un
 * fichier que personne n'a demandé. Le logo est dans ce cas ; le QR code non,
 * il reste utile en pièce jointe.
 */
export interface PieceJointeMail {
  filename: string;
  content: Buffer;
  contentType?: string;
  cid?: string;
  decorative?: boolean;
}

/** Ce que les gabarits lisent sous `charte`. Jamais d'octets : que du texte. */
export interface CharteEmail {
  nom: string;
  annee: number | null;
  couleurPrimaire: string;
  couleurSecondaire: string;
  contrastePrimaire: string;
  /** Fond des encarts d'information : la secondaire à 10 % sur du blanc. */
  teinte: string;
  /** Bordure des mêmes encarts : la secondaire à 45 %. */
  bordTeinte: string;
  /** `cid:…` quand le logo accompagne le message, sinon `null`. */
  logo: string | null;
}

/**
 * Mélange une couleur avec du blanc.
 *
 * Calculé ici plutôt qu'écrit en `rgba()` : Outlook pour Windows ignore la
 * transparence et peindrait l'encart de la couleur pleine.
 */
export function eclaircir(hexa: string, opacite: number): string {
  const brut = hexa.replace('#', '');
  const complet =
    brut.length === 3
      ? brut
          .split('')
          .map((c) => c + c)
          .join('')
      : brut;

  const canal = (position: number): string => {
    const valeur = Number.parseInt(complet.slice(position, position + 2), 16);
    const melange = Math.round(valeur * opacite + 255 * (1 - opacite));
    return melange.toString(16).padStart(2, '0');
  };

  return `#${canal(0)}${canal(2)}${canal(4)}`.toUpperCase();
}

/**
 * Reconnaît un format d'image que les messageries affichent.
 *
 * Un bureau peut téléverser un SVG ou un WebP : Outlook et une partie des
 * clients mobiles n'en affichent aucun. Mieux vaut un en-tête sans logo qu'un
 * cadre cassé — le nom du mandat, lui, est toujours là.
 */
export function typeImageAffichable(
  octets: Buffer,
): { mime: string; extension: string } | null {
  if (
    octets.length > 8 &&
    octets.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (octets.length > 3 && octets[0] === 0xff && octets[1] === 0xd8) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (octets.length > 6 && octets.subarray(0, 4).toString('ascii') === 'GIF8') {
    return { mime: 'image/gif', extension: 'gif' };
  }
  return null;
}

/**
 * Prépare la charte pour un message : le texte pour les gabarits, et le logo
 * en pièce jointe incrustée quand son format s'y prête.
 */
export function preparerCharte(charte: IdentiteVisuelle): {
  charte: CharteEmail;
  logo: PieceJointeMail | null;
} {
  const format = charte.logo ? typeImageAffichable(charte.logo) : null;

  const logo =
    charte.logo && format
      ? {
          filename: `logo.${format.extension}`,
          content: charte.logo,
          contentType: format.mime,
          cid: CID_LOGO,
          decorative: true,
        }
      : null;

  return {
    charte: {
      nom: charte.nom,
      annee: charte.annee,
      couleurPrimaire: charte.couleurPrimaire,
      couleurSecondaire: charte.couleurSecondaire,
      contrastePrimaire: charte.contrastePrimaire,
      teinte: eclaircir(charte.couleurSecondaire, 0.1),
      bordTeinte: eclaircir(charte.couleurSecondaire, 0.45),
      logo: logo ? `cid:${CID_LOGO}` : null,
    },
    logo,
  };
}
