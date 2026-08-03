export type OptionsTls = false | { ca?: string; rejectUnauthorized: boolean };

/**
 * Options TLS de la connexion à la base.
 *
 * La vérification du certificat est **active par défaut** : sans elle, la
 * connexion accepte n'importe quel certificat, y compris celui d'un attaquant
 * interposé, ce qui expose les données personnelles et les transactions.
 *
 * Certains hébergeurs présentent un certificat auto-signé et imposent de
 * désactiver cette vérification. C'est un choix dégradé, qui doit rester
 * explicite : il faut alors positionner DATABASE_SSL_REJECT_UNAUTHORIZED=false.
 * La bonne réponse reste de fournir le certificat de l'autorité via
 * DATABASE_SSL_CA plutôt que de renoncer à toute vérification.
 *
 * Partagé entre la configuration NestJS et la source de données du CLI, pour
 * que les migrations ne se connectent jamais dans des conditions plus laxistes
 * que l'application elle-même.
 */
export function optionsTls(): OptionsTls {
  if (process.env.DATABASE_SSL !== 'true') {
    return false;
  }

  const ca = process.env.DATABASE_SSL_CA;
  if (ca) {
    return { ca, rejectUnauthorized: true };
  }

  return {
    rejectUnauthorized:
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
}
