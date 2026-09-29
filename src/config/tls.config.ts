import { readFileSync } from 'node:fs';

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
 * DATABASE_SSL_CA_FILE donne la même autorité par son chemin. C'est la forme
 * adaptée à un conteneur, où le certificat se monte en fichier : un PEM tient
 * sur plusieurs lignes, et le glisser dans une variable d'environnement dépend
 * de la façon dont chaque outil lit les valeurs multilignes.
 *
 * Partagé entre la configuration NestJS et la source de données du CLI, pour
 * que les migrations ne se connectent jamais dans des conditions plus laxistes
 * que l'application elle-même.
 */
// L'union false | objet n'est pas un choix : c'est la forme qu'attend l'option
// `ssl` de TypeORM, ou `false` desactive TLS et un objet le configure. Une
// forme unique obligerait chaque appelant a la retraduire.
// eslint-disable-next-line sonarjs/function-return-type
export function optionsTls(): OptionsTls {
  if (process.env.DATABASE_SSL !== 'true') {
    return false;
  }

  // Un chemin illisible lève ici plutôt que de retomber sans autorité : la
  // connexion refuserait alors un certificat parfaitement légitime, et
  // l'erreur afficherait un défaut de certificat au lieu du fichier manquant.
  const fichier = process.env.DATABASE_SSL_CA_FILE;
  const ca =
    process.env.DATABASE_SSL_CA ||
    (fichier ? readFileSync(fichier, 'utf8') : undefined);
  if (ca) {
    return { ca, rejectUnauthorized: true };
  }

  return {
    rejectUnauthorized:
      process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
}
