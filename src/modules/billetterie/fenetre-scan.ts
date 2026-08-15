/**
 * Délai d'ouverture avant le début de l'événement.
 *
 * Les portiers arrivent en avance : refuser le premier billet parce qu'il est
 * 17 h 55 pour un gala à 18 h ferait perdre le contrôle dès l'ouverture des
 * portes. Deux heures suffisent à installer l'accueil sans rendre la
 * validation permanente.
 */
export const OUVERTURE_AVANT_MS = 2 * 60 * 60 * 1000;

/** Heure de fermeture, le lendemain de l'événement. */
export const HEURE_FERMETURE = 10;

export enum EtatFenetre {
  OUVERTE = 'OUVERTE',
  TROP_TOT = 'TROP_TOT',
  TROP_TARD = 'TROP_TARD',
}

/**
 * Décide si un billet peut être validé à cet instant.
 *
 * Le service ne regardait pas la date : un billet du gala de juin restait
 * validable l'an suivant, et rien n'empêchait de vider une salle par
 * anticipation. La fenêtre referme les deux côtés.
 *
 * **Elle se ferme à 10 h le lendemain**, et non à la fin annoncée. Un gala qui
 * se termine à 3 h du matin déborde sur le jour suivant ; couper à `dateFin`
 * refuserait les derniers entrants, et couper à minuit couperait en plein
 * milieu. Le lendemain matin laisse la soirée se finir tout en fermant la
 * porte avant que le billet ne serve une seconde fois.
 *
 * Fonction pure : `maintenant` est passé en paramètre pour que les tests
 * décident du moment plutôt que de dépendre de l'horloge.
 */
export function etatFenetre(
  dateDebut: Date,
  dateFin: Date | null,
  maintenant: Date = new Date(),
): EtatFenetre {
  if (maintenant.getTime() < dateDebut.getTime() - OUVERTURE_AVANT_MS) {
    return EtatFenetre.TROP_TOT;
  }

  return maintenant.getTime() > fermeture(dateFin ?? dateDebut).getTime()
    ? EtatFenetre.TROP_TARD
    : EtatFenetre.OUVERTE;
}

/**
 * Dix heures, le jour suivant celui de la référence.
 *
 * Construite par composants plutôt qu'en ajoutant vingt-quatre heures : un
 * changement d'heure décalerait le résultat d'une heure, et la fermeture ne
 * tomberait plus à l'heure annoncée.
 */
function fermeture(reference: Date): Date {
  const lendemain = new Date(reference);
  lendemain.setDate(lendemain.getDate() + 1);
  lendemain.setHours(HEURE_FERMETURE, 0, 0, 0);

  return lendemain;
}

/** Message à rendre au portier, qui doit comprendre sans appeler le bureau. */
export function motifRefus(etat: EtatFenetre): string {
  return etat === EtatFenetre.TROP_TOT
    ? 'Cet événement n’a pas encore commencé : la validation ouvre deux heures avant le début.'
    : 'Cet événement est terminé : la validation a fermé le lendemain à 10 h.';
}
