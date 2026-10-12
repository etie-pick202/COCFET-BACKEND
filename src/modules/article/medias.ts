/**
 * Les médias (images, vidéos) que le corps d'un article embarque.
 *
 * Le corps est du Markdown : un média s'y écrit `![légende](clé)`, où la clé
 * est celle que le stockage a renvoyée au téléversement. Le rendu l'échange
 * contre une URL signée, comme pour une couverture.
 *
 * Cette liste sert au ménage : quand un passage est retiré du texte ou que
 * l'article est supprimé, ses médias doivent l'être aussi du stockage, sans
 * quoi ils y resteraient indéfiniment, personne ne les référençant plus.
 */

/** Une clé de média d'article : images dans « articles/ », vidéos dans « videos/ ». */
const CLE_MEDIA = /^(?:articles|videos)\/[A-Za-z0-9._-]+$/;

/**
 * Longueur maximale d'une légende ou d'une clé lue dans le texte.
 *
 * Borne le travail par média : le texte est saisi par un utilisateur, et une
 * expression régulière sur 50 000 caractères de « ![![![… » s'exécuterait en
 * temps quadratique. Une lecture à la main, bornée, reste linéaire.
 */
const LONGUEUR_MAX = 300;

/** Les clés de média citées par un texte, sans doublon et dans l'ordre. */
export function clesDeMedias(contenu: string | null | undefined): string[] {
  if (!contenu) {
    return [];
  }

  const cles = new Set<string>();
  let position = 0;

  // Forme cherchée : ![légende](clé)
  while ((position = contenu.indexOf('![', position)) !== -1) {
    const debutLegende = position + 2;
    const legende = contenu.slice(
      debutLegende,
      debutLegende + LONGUEUR_MAX + 1,
    );
    const fermeture = legende.indexOf('](');

    if (fermeture === -1 || legende.slice(0, fermeture).includes(']')) {
      position = debutLegende;
      continue;
    }

    const debutCible = debutLegende + fermeture + 2;
    const reste = contenu.slice(debutCible, debutCible + LONGUEUR_MAX + 1);
    const fin = reste.indexOf(')');

    if (fin === -1) {
      position = debutCible;
      continue;
    }

    const cible = reste.slice(0, fin);
    if (CLE_MEDIA.test(cible)) {
      cles.add(cible);
    }
    position = debutCible + fin + 1;
  }

  return [...cles];
}

/** Les médias qu'un texte citait avant, et qu'il ne cite plus. */
export function mediasRetires(
  avant: string | null | undefined,
  apres: string | null | undefined,
): string[] {
  const restants = new Set(clesDeMedias(apres));
  return clesDeMedias(avant).filter((cle) => !restants.has(cle));
}
