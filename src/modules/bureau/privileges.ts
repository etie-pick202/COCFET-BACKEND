/**
 * Privilèges attachés à un **poste**, au-delà du simple rôle d'administrateur.
 *
 * Le rôle `ADMIN` dit qu'une personne administre la plateforme ; il ne dit pas
 * ce qu'elle a le droit de savoir. La chargée des activités publie des
 * événements sans avoir à connaître les recettes, et c'est ce que ces
 * privilèges expriment.
 *
 * Ils vivent sur le poste et non sur le compte : à la passation, le nouveau
 * titulaire hérite des droits de sa fonction sans qu'on touche à son profil,
 * et l'ancien les perd du même mouvement.
 */
export enum Privilege {
  /** Indicateurs financiers et journal des transactions. */
  TRESORERIE = 'TRESORERIE',

  /**
   * Initier un retrait vers un compte Mobile Money.
   *
   * Volontairement distinct de `TRESORERIE` : lire les comptes et les vider
   * ne relèvent pas du même risque. Un commissaire aux comptes doit pouvoir
   * tout consulter sans jamais pouvoir sortir un franc.
   */
  RETRAIT = 'RETRAIT',
}

/** Ce dont dispose un membre du bureau pour le mandat en cours. */
export interface PrivilegesMembre {
  accedeTresorerie: boolean;
  autoriseRetrait: boolean;
}

/** Aucun privilège : la réponse pour qui ne siège pas au bureau actif. */
export const AUCUN_PRIVILEGE: PrivilegesMembre = {
  accedeTresorerie: false,
  autoriseRetrait: false,
};

export function detient(
  privileges: PrivilegesMembre,
  privilege: Privilege,
): boolean {
  return privilege === Privilege.TRESORERIE
    ? privileges.accedeTresorerie
    : privileges.autoriseRetrait;
}
