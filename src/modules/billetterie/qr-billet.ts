import { toBuffer } from 'qrcode';

/**
 * Niveau de correction d'erreur.
 *
 * « M » tolère environ 15 % de dégradation. Un billet est lu sur l'écran d'un
 * téléphone, à l'entrée, souvent de nuit et parfois derrière une vitre rayée :
 * le niveau le plus bas ferait échouer des lectures que ce niveau rattrape,
 * au prix d'une image à peine plus dense.
 */
const CORRECTION = 'M' as const;

/** Marge blanche, en modules. En dessous de 2, les lecteurs peinent à cadrer. */
const MARGE = 2;

/** Côté de l'image, en pixels. Suffisant pour un affichage plein écran. */
const TAILLE = 512;

/**
 * Encode le code d'entrée d'un billet en QR code PNG.
 *
 * Le QR ne porte que le code du billet — ni nom, ni adresse, ni identifiant de
 * compte. Un billet se photographie, se transfère et traîne dans une galerie :
 * y inscrire des données personnelles les rendrait lisibles par quiconque
 * pointe un téléphone dessus. Le code, lui, ne dit rien de son porteur et ne
 * vaut que présenté à `POST /billets/scanner`, qui vérifie statut et paiement.
 */
export async function genererQrBillet(codeBillet: string): Promise<Buffer> {
  return toBuffer(codeBillet, {
    errorCorrectionLevel: CORRECTION,
    margin: MARGE,
    width: TAILLE,
    type: 'png',
  });
}

/**
 * Emballe le PNG en URL de données, forme sous laquelle le billet est stocké.
 *
 * Le frontend l'affiche alors directement dans un `<img>`, sans requête
 * supplémentaire ni objet à servir depuis le stockage : le QR se régénère à
 * l'identique à partir du code, il n'a donc rien à faire dans un bucket.
 */
export function enUrlDeDonnees(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}
