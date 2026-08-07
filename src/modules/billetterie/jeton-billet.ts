import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Durée de vie d'une fenêtre, en secondes.
 *
 * Assez court pour qu'une capture d'écran transmise arrive périmée, assez long
 * pour laisser le temps de sortir son téléphone, l'orienter et le faire lire.
 * En descendant à 10 s, un porteur légitime se ferait refuser pour avoir mis
 * trop de temps à déverrouiller son écran.
 */
export const FENETRE_SECONDES = 30;

/**
 * Fenêtres acceptées de part et d'autre de la fenêtre courante.
 *
 * Le code est affiché à un instant et lu à un autre : entre les deux, la file
 * avance et les horloges du téléphone et du serveur ne coïncident pas à la
 * seconde près. Sans cette tolérance, un billet présenté à cheval sur deux
 * fenêtres serait refusé sans raison compréhensible.
 */
const TOLERANCE = 1;

const SEPARATEUR = '.';

/** Fenêtre courante, dérivée de l'horloge — rien n'est stocké. */
function fenetreAt(instant: number): number {
  return Math.floor(instant / 1000 / FENETRE_SECONDES);
}

function signer(codeBillet: string, fenetre: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${codeBillet}${SEPARATEUR}${fenetre}`)
    .digest('base64url');
}

/**
 * Jeton d'entrée valable une fenêtre.
 *
 * Le code du billet y figure en clair : c'est lui qui permet de retrouver
 * l'inscription au scan, et le lire n'apprend rien d'exploitable — sans le
 * secret, nul ne peut signer la fenêtre suivante. Ce qui se photographie est
 * donc périmé avant d'avoir servi.
 */
export function emettreJetonBillet(
  codeBillet: string,
  secret: string,
  maintenant = Date.now(),
): string {
  const fenetre = fenetreAt(maintenant);

  return [codeBillet, fenetre, signer(codeBillet, fenetre, secret)].join(
    SEPARATEUR,
  );
}

/** Secondes restantes avant que le jeton courant ne soit remplacé. */
export function secondesAvantRotation(maintenant = Date.now()): number {
  return FENETRE_SECONDES - (Math.floor(maintenant / 1000) % FENETRE_SECONDES);
}

/** Vrai si la valeur présentée a la forme d'un jeton tournant. */
export function estJetonTournant(valeur: string): boolean {
  return valeur.split(SEPARATEUR).length === 3;
}

/**
 * Vérifie un jeton et rend le code du billet qu'il porte.
 *
 * Rend `null` sur toute anomalie — forme inattendue, fenêtre périmée,
 * signature fausse — sans distinguer les cas : dire *pourquoi* un jeton est
 * refusé aiderait à en fabriquer un.
 */
export function lireJetonBillet(
  jeton: string,
  secret: string,
  maintenant = Date.now(),
): string | null {
  const morceaux = jeton.split(SEPARATEUR);
  if (morceaux.length !== 3) {
    return null;
  }

  const [codeBillet, fenetreBrute, signature] = morceaux;
  const fenetre = Number(fenetreBrute);
  if (!Number.isInteger(fenetre)) {
    return null;
  }

  const courante = fenetreAt(maintenant);
  if (Math.abs(courante - fenetre) > TOLERANCE) {
    return null;
  }

  return comparaisonConstante(signature, signer(codeBillet, fenetre, secret))
    ? codeBillet
    : null;
}

/**
 * Comparaison à temps constant.
 *
 * Une comparaison ordinaire s'arrête au premier octet différent : le temps de
 * réponse trahit alors le nombre de caractères devinés, et permet de
 * reconstruire une signature valide octet par octet.
 */
function comparaisonConstante(fournie: string, attendue: string): boolean {
  const a = Buffer.from(fournie);
  const b = Buffer.from(attendue);

  return a.length === b.length && timingSafeEqual(a, b);
}
