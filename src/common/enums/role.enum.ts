export enum Role {
  /** Utilisateur externe au campus (tarif plein). */
  VISITOR = 'VISITOR',
  /** Étudiant UCAC-ICAM identifié par son email universitaire (tarif campus). */
  STUDENT = 'STUDENT',
  /** Entreprise partenaire, accès à l'annuaire selon son palier. */
  SPONSOR = 'SPONSOR',
  /** Membre du Bureau des Finissants, contrôle total. */
  ADMIN = 'ADMIN',
}
