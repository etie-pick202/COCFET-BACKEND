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

const IMAGE_MARKDOWN = /!\[[^\]]*\]\(([^)\s]+)\)/g;

/** Les clés de média citées par un texte, sans doublon et dans l'ordre. */
export function clesDeMedias(contenu: string | null | undefined): string[] {
  if (!contenu) {
    return [];
  }

  const cles = new Set<string>();
  for (const [, cible] of contenu.matchAll(IMAGE_MARKDOWN)) {
    if (CLE_MEDIA.test(cible)) {
      cles.add(cible);
    }
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
