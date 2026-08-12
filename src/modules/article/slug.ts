/** Longueur maximale d'un slug, avant le suffixe de désambiguïsation. */
const LONGUEUR_MAX = 80;

/** Slug de repli, quand le titre ne laisse aucun caractère exploitable. */
const REPLI = 'article';

/**
 * Fabrique la partie lisible de l'URL d'un article.
 *
 * Le slug entre dans une adresse que l'on partage et qui doit rester stable :
 * il ne peut donc contenir ni accent, ni espace, ni ponctuation. La
 * décomposition Unicode (`NFD`) sépare la lettre de son accent, ce qui permet
 * de retirer les diacritiques sans table de correspondance — « Rétrospective »
 * devient « retrospective » plutôt que « r-trospective ».
 *
 * Un titre entièrement composé de caractères non latins — un titre en arabe,
 * une suite d'emojis — ne laisse rien derrière lui. Le repli évite un slug
 * vide, qui produirait une URL se confondant avec la liste des articles.
 */
export function fabriquerSlug(titre: string): string {
  const slug = titre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    // Un seul tiret suffit à décrire chaque extrémité : la ligne précédente a
    // déjà réduit toute suite de séparateurs à un caractère. Écrire « -+ » ici
    // ouvrirait un retour sur trace quadratique sur une entrée construite pour
    // ça — un titre fait de mille signes de ponctuation.
    .replace(/^-/, '')
    .replace(/-$/, '')
    .slice(0, LONGUEUR_MAX)
    // La troncature peut tomber juste après un séparateur : « ...de- » n'est
    // pas une fin de slug acceptable.
    .replace(/-$/, '');

  return slug || REPLI;
}

/**
 * Rend un slug libre, en le suffixant si nécessaire.
 *
 * Deux articles peuvent légitimement porter le même titre — un compte rendu
 * annuel, par exemple. Le slug est unique en base : sans cette
 * désambiguïsation, la création du second échouerait sur une violation de
 * contrainte, erreur que le bureau ne saurait pas interpréter.
 *
 * `estPris` est fourni par l'appelant plutôt que d'interroger la base ici : la
 * fonction reste pure et testable, et le service garde la main sur la requête.
 */
export async function slugLibre(
  titre: string,
  estPris: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = fabriquerSlug(titre);

  if (!(await estPris(base))) {
    return base;
  }

  // Borné : au-delà, c'est que quelque chose d'autre ne va pas, et une boucle
  // sans fin sur une base injoignable serait pire que l'erreur.
  for (let suffixe = 2; suffixe <= 100; suffixe += 1) {
    const candidat = `${base}-${suffixe}`;
    if (!(await estPris(candidat))) {
      return candidat;
    }
  }

  // Dernier recours : l'horodatage tranche à coup sûr.
  return `${base}-${Date.now()}`;
}
