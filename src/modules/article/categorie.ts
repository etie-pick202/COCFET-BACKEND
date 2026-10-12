/**
 * Une catégorie saisie à la main devient vite plusieurs : « Sport », « sport »
 * et « Sport  » se retrouvaient comme trois filtres. On la normalise à
 * l'écriture : espaces nettoyés, et l'orthographe déjà utilisée est reprise
 * quand la nouvelle n'en diffère que par la casse ou les accents.
 */

/** Forme de comparaison : sans accents, sans casse, espaces réduits. */
export function cleDeCategorie(categorie: string): string {
  return categorie
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * La catégorie à enregistrer.
 *
 * - vide (ou blanche) : aucune catégorie ;
 * - déjà connue, à la casse ou aux accents près : l'orthographe existante ;
 * - nouvelle : la saisie nettoyée, avec une majuscule initiale.
 */
export function normaliserCategorie(
  saisie: string | null | undefined,
  existantes: readonly string[],
): string | null {
  const propre = (saisie ?? '').replace(/\s+/g, ' ').trim();
  if (!propre) {
    return null;
  }

  const cle = cleDeCategorie(propre);
  const connue = existantes.find((e) => cleDeCategorie(e) === cle);
  if (connue) {
    return connue;
  }

  return propre.charAt(0).toLocaleUpperCase('fr-FR') + propre.slice(1);
}
