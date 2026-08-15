export enum Role {
  /** Utilisateur externe au campus (tarif plein). */
  VISITOR = 'VISITOR',
  /** Étudiant UCAC-ICAM identifié par son email universitaire (tarif campus). */
  STUDENT = 'STUDENT',
  /** Entreprise partenaire, accès à l'annuaire selon son palier. */
  SPONSOR = 'SPONSOR',
  /** Membre du Bureau des Finissants, contrôle total. */
  ADMIN = 'ADMIN',
  /**
   * Exploitation de la plateforme, au-dessus des privilèges du bureau.
   *
   * Ne s'obtient par aucun parcours applicatif : ni l'inscription, ni la
   * passation d'un mandat, ni la modification d'un compte ne l'attribuent.
   */
  SUPER_ADMIN = 'SUPER_ADMIN',
}

/**
 * Rôles qui administrent la plateforme.
 *
 * **Le seul test d'administration autorisé passe par `estAdministrateur`.**
 * Comparer directement à `Role.ADMIN` laisserait `SUPER_ADMIN` en dehors —
 * moins puissant que l'administration ordinaire, ce qui est exactement
 * l'inverse de ce qu'il doit être. Une règle de lint interdit d'ailleurs cette
 * comparaison, pour que le code à venir ne rouvre pas la brèche par
 * inadvertance.
 */
export const ROLES_ADMINISTRATEURS: readonly Role[] = [
  Role.ADMIN,
  Role.SUPER_ADMIN,
];

/** Vrai quand ce rôle administre, quel qu'en soit le degré. */
export function estAdministrateur(role: Role | undefined | null): boolean {
  return (
    role !== undefined && role !== null && ROLES_ADMINISTRATEURS.includes(role)
  );
}

/**
 * Rôles qu'une requête peut attribuer.
 *
 * `SUPER_ADMIN` en est **exclu**, et c'est essentiel : sans cela, un
 * administrateur pourrait se l'attribuer par la route de mise à jour d'un
 * compte, et le rôle n'aurait plus rien d'exceptionnel. Il ne s'obtient par
 * aucun parcours applicatif.
 */
export const ROLES_ATTRIBUABLES = [
  Role.VISITOR,
  Role.STUDENT,
  Role.SPONSOR,
  Role.ADMIN,
] as const;
