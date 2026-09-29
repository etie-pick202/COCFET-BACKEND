import { SetMetadata } from '@nestjs/common';

export const LIMITE_DEBIT_KEY = 'limiteDebit';
export const SANS_LIMITE_DEBIT_KEY = 'sansLimiteDebit';

export interface OptionsLimiteDebit {
  requetes: number;
  fenetreSecondes: number;
}

/**
 * Plafond propre à une route, plus strict que le plafond général.
 *
 * Le budget global — cent requêtes par minute — convient à la navigation :
 * une page d'événements enchaîne plusieurs appels. Il est bien trop large pour
 * une tentative de connexion : cent essais de mot de passe par minute, c'est
 * une attaque par force brute qui passe sans être inquiétée.
 */
export const LimiteDebit = (options: OptionsLimiteDebit) =>
  SetMetadata(LIMITE_DEBIT_KEY, options);

/**
 * Soustrait une route au limiteur.
 *
 * Réservé aux routes qui ne donnent accès à rien et qu'une machine appelle en
 * boucle : la sonde de santé, interrogée toutes les dix secondes par Docker
 * dans chaque environnement. La compter consommerait des milliers d'appels
 * Upstash par jour — l'essentiel du quota gratuit — sans rien protéger.
 */
export const SansLimiteDebit = () => SetMetadata(SANS_LIMITE_DEBIT_KEY, true);

/**
 * Plafond des routes d'authentification.
 *
 * Dix tentatives par minute laissent largement de quoi se tromper de mot de
 * passe, et ramènent une attaque par dictionnaire à un rythme inexploitable.
 */
export const LIMITE_AUTHENTIFICATION: OptionsLimiteDebit = {
  requetes: 10,
  fenetreSecondes: 60,
};

/**
 * Plafond des routes qui déclenchent un envoi d'email.
 *
 * Chaque appel consomme le quota Brevo et remplit une boîte qui n'a rien
 * demandé. Trois par minute suffisent à un usage légitime.
 */
export const LIMITE_ENVOI_EMAIL: OptionsLimiteDebit = {
  requetes: 3,
  fenetreSecondes: 60,
};
