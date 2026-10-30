import { BadRequestException } from '@nestjs/common';
import { MOTIF_CLE } from './ports/stockage';

/**
 * Propriété des fichiers personnels.
 *
 * Une clé de stockage n'est qu'un texte : sans contrôle, un compte pouvait
 * déclarer comme sa photo la clé du logo du mandat ou la photo d'un autre
 * membre, puis changer de photo — et le nettoyage supprimait alors le fichier
 * d'autrui. Les fichiers personnels (photo, CV, justificatif, logo de
 * partenaire) portent donc l'identifiant de leur auteur dans leur nom :
 * `avatars/<id>_<uuid>-photo.png`. Le serveur sait ainsi, sans table ni
 * requête, à qui appartient une clé qu'on lui présente.
 */

/** Ce qui précède le nom d'un fichier déposé par `proprietaireId`. */
export function segmentProprietaire(proprietaireId?: string): string {
  return proprietaireId ? `${proprietaireId}_` : '';
}

/** Vrai quand la clé est bien formée et rangée dans ce dossier. */
export function estDansDossier(cle: unknown, dossier: string): cle is string {
  return (
    typeof cle === 'string' &&
    MOTIF_CLE.test(cle) &&
    cle.startsWith(`${dossier}/`)
  );
}

/** Vrai quand la clé désigne un fichier de ce dossier déposé par cette personne. */
export function appartientA(
  cle: unknown,
  dossier: string,
  proprietaireId: string,
): boolean {
  return (
    estDansDossier(cle, dossier) &&
    cle.startsWith(`${dossier}/${segmentProprietaire(proprietaireId)}`)
  );
}

/** Une valeur qui retire le fichier plutôt que d'en désigner un. */
function retire(cle: string | null | undefined): boolean {
  return cle === undefined || cle === null || cle === '';
}

/**
 * Refuse une clé que la personne n'a pas déposée elle-même.
 *
 * La valeur déjà enregistrée reste acceptée telle quelle : un formulaire qui
 * renvoie la fiche entière ne doit pas échouer sur une photo qu'il ne change
 * pas, même déposée avant que les clés portent leur auteur.
 */
export function exigerFichierDe(
  proprietaireId: string,
  dossier: string,
  nouvelle: string | null | undefined,
  actuelle?: string | null,
): void {
  if (retire(nouvelle) || nouvelle === actuelle) {
    return;
  }
  if (!appartientA(nouvelle, dossier, proprietaireId)) {
    throw new BadRequestException(
      `Ce fichier ne vous appartient pas : déposez-le d’abord vous-même (dossier « ${dossier} »).`,
    );
  }
}

/**
 * Refuse une clé rangée hors du dossier attendu.
 *
 * Pour les écritures du bureau, qui dépose pour le compte d'un partenaire :
 * l'auteur du fichier n'est pas le titulaire de la fiche, mais le logo d'un
 * partenaire n'a pas à désigner le CV d'un finissant.
 */
export function exigerFichierDuDossier(
  dossier: string,
  nouvelle: string | null | undefined,
  actuelle?: string | null,
): void {
  if (retire(nouvelle) || nouvelle === actuelle) {
    return;
  }
  if (!estDansDossier(nouvelle, dossier)) {
    throw new BadRequestException(
      `Ce fichier n’a pas été déposé pour cet usage (dossier « ${dossier} » attendu).`,
    );
  }
}
