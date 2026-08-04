import { INestApplication } from '@nestjs/common';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { Role } from '../../src/common/enums/role.enum';
import { JwtPayload } from '../../src/modules/auth/strategies/jwt.strategy';
import { User } from '../../src/modules/user/entities/user.entity';

/**
 * Fabrique de comptes authentifiés pour les tests end-to-end.
 *
 * Les jetons produits ici sont **de vrais JWT** : signés par le JwtService de
 * l'application, avec le secret de l'environnement de test, et validés par la
 * vraie JwtStrategy — laquelle relit l'utilisateur en base à chaque requête.
 * C'est la raison pour laquelle le compte est réellement créé et non simulé :
 * un jeton bien formé pointant vers un utilisateur inexistant est rejeté, et
 * doit l'être.
 *
 * Remplacer les gardes par des doubles ferait passer les tests sans jamais
 * exercer l'autorisation — c'est-à-dire précisément ce qu'ils sont censés
 * vérifier.
 */

export interface OptionsCompte {
  role?: Role;
  email?: string;
  prenom?: string;
  nom?: string;
  promotion?: number | null;
  isFinissant?: boolean;
  isActive?: boolean;
  /** Compte créé mais email non confirmé : sert aux cas d'accès refusé. */
  emailVerifie?: boolean;
}

export interface CompteDeTest {
  user: User;
  accessToken: string;
  /** À passer tel quel à `.set(...)` de supertest. */
  entetes: { Authorization: string };
}

/** Adresse institutionnelle valide et unique, au format attendu par l'application. */
export function emailEtudiant(promotion = 2027): string {
  return `test.${randomUUID().slice(0, 8)}@${promotion}.ucac-icam.com`;
}

export function emailExterne(): string {
  return `externe.${randomUUID().slice(0, 8)}@gmail.com`;
}

/**
 * Crée un utilisateur en base et renvoie un jeton d'accès valide pour lui.
 *
 * Le mot de passe n'est pas renseigné : ce compte sert à appeler des routes
 * protégées, pas à se connecter. Les tests du parcours de connexion passent
 * par les vrais endpoints.
 */
export async function creerCompteAuthentifie(
  app: INestApplication,
  options: OptionsCompte = {},
): Promise<CompteDeTest> {
  const {
    role = Role.STUDENT,
    promotion = role === Role.STUDENT ? 2027 : null,
    email = promotion !== null ? emailEtudiant(promotion) : emailExterne(),
    prenom = 'Test',
    nom = 'Utilisateur',
    isFinissant = false,
    isActive = true,
    emailVerifie = true,
  } = options;

  const users = app.get<Repository<User>>(getRepositoryToken(User));

  const user = await users.save(
    users.create({
      email: email.toLowerCase(),
      firstName: prenom,
      lastName: nom,
      role,
      promotion,
      isFinissant,
      isActive,
      emailVerifieLe: emailVerifie ? new Date() : null,
    }),
  );

  // Un seul appel : chaque signature porte un `jti` différent, deux appels
  // rendraient l'en-tête et `accessToken` désynchronisés.
  const accessToken = signerAcces(app, user);

  return { user, accessToken, ...enteteDe(accessToken) };
}

/** Signe un jeton d'accès pour un utilisateur existant. */
export function signerAcces(
  app: INestApplication,
  user: Pick<User, 'id' | 'email' | 'role'>,
  options: JwtSignOptions = {},
): string {
  const charge: JwtPayload = {
    sub: user.id,
    email: user.email,
    role: user.role,
    jti: randomUUID(),
  };

  return app.get(JwtService).sign(charge, options);
}

/**
 * Jeton correctement signé mais expiré.
 *
 * Utile pour vérifier qu'une route refuse bien un jeton périmé : une signature
 * valide ne suffit pas.
 */
export function jetonExpire(
  app: INestApplication,
  user: Pick<User, 'id' | 'email' | 'role'>,
): string {
  return signerAcces(app, user, { expiresIn: '-1s' });
}

/**
 * Jeton signé avec un autre secret.
 *
 * Représente le cas d'un jeton fabriqué par un tiers : la charge utile est
 * plausible, la signature ne l'est pas.
 */
export function jetonSigneAilleurs(
  user: Pick<User, 'id' | 'email' | 'role'>,
): string {
  return new JwtService({ secret: 'un-autre-secret-que-le-notre' }).sign({
    sub: user.id,
    email: user.email,
    role: user.role,
  });
}

export function enteteDe(accessToken: string): {
  entetes: { Authorization: string };
} {
  return { entetes: { Authorization: `Bearer ${accessToken}` } };
}

/**
 * Vide les tables touchées par les fixtures.
 *
 * `DELETE` et non `TRUNCATE` : les tests partagent une base avec des données
 * de référence (générations) qu'il ne faut pas emporter.
 */
export async function purgerUtilisateurs(app: INestApplication): Promise<void> {
  const users = app.get<Repository<User>>(getRepositoryToken(User));
  await users.createQueryBuilder().delete().execute();
}
