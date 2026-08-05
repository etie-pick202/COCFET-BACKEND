import { SetMetadata } from '@nestjs/common';

export const AUTH_OPTIONNELLE_KEY = 'authOptionnelle';

/**
 * Route ouverte à tous, qui exploite le jeton lorsqu'il est présent.
 *
 * Le cas typique est la fiche d'un événement : un visiteur non connecté doit
 * pouvoir la consulter, mais un étudiant connecté doit y voir **son** tarif.
 * Avec `@Public()`, le jeton n'est jamais lu et tout le monde verrait le tarif
 * externe ; en exigeant l'authentification, la page deviendrait inaccessible
 * avant connexion.
 *
 * Un jeton absent, expiré ou invalide laisse simplement passer sans
 * utilisateur : il ne s'agit pas d'un contrôle d'accès.
 */
export const AuthOptionnelle = () => SetMetadata(AUTH_OPTIONNELLE_KEY, true);
