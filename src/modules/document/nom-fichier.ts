import { ContenuDocument } from './entities/contenu-document';

/** Longueur maximale du nom, extension exclue : au-delà, les systèmes tronquent. */
const LONGUEUR_MAX = 150;

/**
 * Ôte ce qu'un nom de fichier ne supporte pas.
 *
 * `\ / : * ? " < > |` sont refusés par Windows, les caractères de contrôle par
 * tous : le titre d'un événement saisi à la main peut en contenir. Les espaces
 * se resserrent, pour qu'un nom ne soit pas troué par un retour à la ligne.
 */
export function nettoyerNom(texte: string): string {
  // Les caractères de contrôle se filtrent par leur code : une classe de
  // caractères qui les citerait serait refusée, à raison, par le linter.
  const sansControle = [...texte]
    .map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c))
    .join('');

  return sansControle
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Nom sous lequel se télécharge une pièce : « Facture Awa Ndiaye de Gala des
 * finissants ».
 *
 * Il dit à qui est la pièce et à quoi elle se rapporte : un dossier de
 * téléchargements rempli de « FAC-2027-0042.pdf » ne se lit pas, et deux
 * factures du même numéro de série n'ont rien à voir l'une avec l'autre.
 *
 * Calculé depuis le contenu **figé** : le nom d'une facture ne change pas si
 * l'événement est renommé ensuite, pas plus que son montant.
 */
export function nomFichierDocument(
  contenu: ContenuDocument,
  numero: string,
): string {
  const nom = (() => {
    switch (contenu.genre) {
      case 'FACTURE_COMMANDE':
        return `Facture ${contenu.titulaire.nom} de ${objetCommande(contenu.lignes)}`;
      case 'RECU_BILLETTERIE':
        return `Facture ${contenu.titulaire.nom} de ${contenu.evenement}`;
      case 'FACTURE_COTISATION':
        return `Facture ${contenu.titulaire.nom} de ${contenu.cotisation} - ${contenu.echeance}`;
      case 'RAPPORT_TRESORERIE':
        return `Rapport de trésorerie ${periode(contenu.depuis, contenu.jusqua)}`;
    }
  })();

  const propre = nettoyerNom(nom).slice(0, LONGUEUR_MAX).trim();

  // Un nom entièrement vide de sens (titre fait de caractères refusés) ne doit
  // pas produire « .pdf » : le numéro, lui, est toujours là.
  return propre.length > 0 ? propre : numero;
}

/**
 * Ce que dit une commande dans un nom de fichier : son premier article, et
 * combien d'autres l'accompagnent.
 */
function objetCommande(lignes: { designation: string }[]): string {
  if (lignes.length === 0) {
    return 'la boutique';
  }
  // La désignation figée porte « produit · taille · couleur » : seul le nom
  // du produit dit de quoi il s'agit.
  const premier = lignes[0].designation.split(' · ')[0];
  const autres = lignes.length - 1;

  if (autres === 0) {
    return premier;
  }
  const s = autres > 1 ? 's' : '';
  return `${premier} et ${autres} autre${s} article${s}`;
}

function periode(depuis: string | null, jusqua: string | null): string {
  const jour = (iso: string) => iso.slice(0, 10);
  if (depuis && jusqua) return `du ${jour(depuis)} au ${jour(jusqua)}`;
  if (depuis) return `depuis le ${jour(depuis)}`;
  if (jusqua) return `jusqu'au ${jour(jusqua)}`;
  return 'complet';
}

/**
 * En-tête `Content-Disposition` d'un téléchargement.
 *
 * Deux noms, parce que les accents n'ont pas le même sort partout : le nom
 * simple (`filename`) est une repli en ASCII pour les clients anciens, le nom
 * étendu (`filename*`, RFC 5987) porte le vrai, accents compris. Les clients
 * récents préfèrent le second.
 */
export function enteteTelechargement(nom: string): string {
  const repli =
    nom
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '')
      .trim() || 'document';

  const encode = encodeURIComponent(`${nom}.pdf`).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${repli}.pdf"; filename*=UTF-8''${encode}`;
}
