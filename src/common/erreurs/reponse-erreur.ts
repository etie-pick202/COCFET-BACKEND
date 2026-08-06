/**
 * Forme unique de toutes les erreurs renvoyées par l'API.
 *
 * Le frontend peut s'y fier sans traiter de cas particulier, et aucun détail
 * technique n'a besoin de transiter pour que le support soit possible :
 * `identifiantCorrelation` suffit à retrouver la trace complète côté serveur.
 */
export interface ReponseErreur {
  /** Code métier stable, destiné au code appelant (jamais traduit). */
  code: string;
  /** Message lisible, destiné à l'utilisateur final. */
  message: string;
  /** Détail des champs invalides, uniquement pour les erreurs de validation. */
  champs?: Record<string, string[]>;
  horodatage: string;
  chemin: string;
  /** Permet de relier un incident signalé par un utilisateur à sa trace serveur. */
  identifiantCorrelation: string;
}

export const CodeErreur = {
  VALIDATION: 'VALIDATION',
  NON_AUTHENTIFIE: 'NON_AUTHENTIFIE',
  ACCES_REFUSE: 'ACCES_REFUSE',
  INTROUVABLE: 'INTROUVABLE',
  CONFLIT: 'CONFLIT',
  TROP_DE_REQUETES: 'TROP_DE_REQUETES',
  ERREUR_INTERNE: 'ERREUR_INTERNE',
} as const;

export type CodeErreur = (typeof CodeErreur)[keyof typeof CodeErreur];
