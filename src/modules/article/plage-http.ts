/**
 * Lecture de l'en-tête `Range` d'une requête HTTP, pour servir un fichier par
 * morceaux.
 *
 * pdf.js n'a pas besoin des 30 Mo d'un PDF pour afficher sa première page : il
 * demande la fin du fichier (la table des objets), puis les seuls octets des
 * pages qu'il dessine. Sans réponse en `206`, il télécharge tout avant
 * d'afficher quoi que ce soit.
 */
export type Lecture =
  /** Pas de plage demandée (ou forme non gérée) → réponse complète. */
  | { genre: 'tout' }
  /** La plage, ramenée aux bornes du fichier : premier et dernier octet, inclus. */
  | { genre: 'plage'; debut: number; fin: number }
  /** La plage tombe hors du fichier → `416`. */
  | { genre: 'hors' };

const TOUT: Lecture = { genre: 'tout' };
const HORS: Lecture = { genre: 'hors' };

/**
 * Une seule plage est servie : pdf.js n'en demande pas davantage, et un
 * `multipart/byteranges` n'apporterait que du code à maintenir. Une demande
 * à plusieurs plages reçoit donc le fichier entier, ce que la norme permet.
 */
export function lirePlage(entete: string | undefined, taille: number): Lecture {
  const trouve = /^bytes=(\d*)-(\d*)$/.exec(entete?.trim() ?? '');
  if (!trouve) return TOUT;

  const [, brutDebut, brutFin] = trouve;
  if (brutDebut === '' && brutFin === '') return TOUT;

  if (brutDebut === '') {
    // « bytes=-500 » : les 500 derniers octets.
    const derniers = Number(brutFin);
    if (derniers === 0) return HORS;
    return {
      genre: 'plage',
      debut: Math.max(taille - derniers, 0),
      fin: taille - 1,
    };
  }

  const debut = Number(brutDebut);
  const fin =
    brutFin === '' ? taille - 1 : Math.min(Number(brutFin), taille - 1);
  if (debut >= taille || debut > fin) return HORS;

  return { genre: 'plage', debut, fin };
}
