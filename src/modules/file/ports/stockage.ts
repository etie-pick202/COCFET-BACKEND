/**
 * Stockage de fichiers (photos de profil, visuels d'événements, logos de
 * sponsors, articles de la boutique).
 *
 * Les objets ne sont jamais publics : l'accès passe toujours par une URL
 * signée à durée limitée. Un lien de photo de finissant qui ne périme pas
 * resterait valable après la fin du mandat, et se partagerait hors de
 * l'application.
 */
export interface Stockage {
  /** Renvoie la clé de l'objet, seule valeur à conserver en base. */
  televerser(fichier: FichierATeleverser, prefixe?: string): Promise<string>;

  urlSignee(cle: string, expirationSecondes?: number): Promise<string>;

  supprimer(cle: string): Promise<void>;
}

/**
 * Sous-ensemble de `Express.Multer.File` réellement utilisé.
 *
 * Le port reste ainsi indépendant du transport : un import de données ou une
 * tâche planifiée peut téléverser un fichier sans fabriquer un faux objet
 * Multer.
 */
export interface FichierATeleverser {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export const STOCKAGE = Symbol('Stockage');

/**
 * Nettoie un nom de fichier avant de le faire entrer dans une clé.
 *
 * Le nom vient du client : sans cela, `../../etc/passwd` deviendrait un
 * chemin remontant hors du dossier de stockage.
 */
export function assainirNomFichier(nom: string): string {
  const base = nom.split(/[/\\]/).pop() ?? 'fichier';
  const propre = base.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '');
  return propre.slice(0, 100) || 'fichier';
}

/** Forme attendue d'une clé produite par {@link Stockage.televerser}. */
export const MOTIF_CLE = /^[a-z0-9-]+\/[a-zA-Z0-9._-]+$/;
