import * as bcrypt from 'bcrypt';
import { isEmail } from 'class-validator';
import { parseArgs } from 'node:util';
import { In, Repository } from 'typeorm';
import { Role } from '../../common/enums/role.enum';
import { normaliserEmail } from '../../common/identite/identite-campus';
import {
  LONGUEUR_MAXIMALE,
  LONGUEUR_MINIMALE,
  REGLE_COMPOSITION,
} from '../auth/dto/mot-de-passe';
import { User } from './entities/user.entity';

/** Le même coût que l'inscription : un compte créé ici se connecte comme les autres. */
const TOURS_BCRYPT = 12;

/**
 * Rôles que cet outil peut attribuer.
 *
 * `SUPER_ADMIN` ne s'obtient par aucun parcours applicatif — ni l'inscription,
 * ni la passation, ni la modification d'un compte : seul un accès à la base ou
 * à cet outil le donne. `ADMIN` est celui du bureau, que la passation
 * rétrograde à chaque changement de mandat.
 */
export const ROLES_INITIAUX: readonly Role[] = [Role.ADMIN, Role.SUPER_ADMIN];

export interface DemandeAdministrateur {
  email: string;
  prenom: string;
  nom: string;
  role: Role;
  motDePasse: string;
}

/** Un refus attendu : l'outil l'affiche tel quel, sans trace d'appels. */
export class RefusCreationAdministrateur extends Error {}

/** Dit pourquoi un mot de passe est refusé, ou rend `null` s'il convient. */
export function verifierMotDePasse(motDePasse: string): string | null {
  if (motDePasse.length < LONGUEUR_MINIMALE) {
    return `Le mot de passe doit contenir au moins ${LONGUEUR_MINIMALE} caractères.`;
  }
  // bcrypt tronque en silence au-delà de 72 octets : accepter un mot de passe
  // dont seule une partie compte serait pire que de le refuser.
  if (Buffer.byteLength(motDePasse) > LONGUEUR_MAXIMALE) {
    return `Le mot de passe ne peut pas dépasser ${LONGUEUR_MAXIMALE} octets.`;
  }
  if (!REGLE_COMPOSITION.test(motDePasse)) {
    return 'Le mot de passe doit mêler des lettres et au moins un chiffre ou symbole.';
  }
  return null;
}

const AIDE =
  'Usage : creer-admin.js --email <adresse> --prenom <prénom> --nom <nom> ' +
  '[--role ADMIN|SUPER_ADMIN]';

/**
 * Lit les arguments de la ligne de commande.
 *
 * Le mot de passe n'en fait **jamais** partie : un argument se retrouve dans
 * l'historique du shell et dans la liste des processus, lisibles par tout
 * autre compte de la machine. Il se saisit au clavier, sans écho.
 */
export function lireArgumentsAdministrateur(
  argv: string[],
): Omit<DemandeAdministrateur, 'motDePasse'> {
  let valeurs: { [cle: string]: string | boolean | undefined };
  try {
    valeurs = parseArgs({
      args: argv,
      options: {
        email: { type: 'string' },
        prenom: { type: 'string' },
        nom: { type: 'string' },
        role: { type: 'string' },
      },
      strict: true,
    }).values;
  } catch (erreur) {
    throw new RefusCreationAdministrateur(
      `${erreur instanceof Error ? erreur.message : String(erreur)}\n${AIDE}`,
    );
  }

  const email = String(valeurs.email ?? '').trim();
  const prenom = String(valeurs.prenom ?? '').trim();
  const nom = String(valeurs.nom ?? '').trim();
  const role = String(valeurs.role ?? Role.ADMIN)
    .trim()
    .toUpperCase();

  if (!email || !prenom || !nom) {
    throw new RefusCreationAdministrateur(
      `--email, --prenom et --nom sont obligatoires.\n${AIDE}`,
    );
  }
  if (!isEmail(email)) {
    throw new RefusCreationAdministrateur(
      `« ${email} » n'est pas une adresse e-mail.`,
    );
  }
  if (!ROLES_INITIAUX.includes(role as Role)) {
    throw new RefusCreationAdministrateur(
      `Rôle « ${role} » refusé : ${ROLES_INITIAUX.join(' ou ')}.`,
    );
  }

  return { email, prenom, nom, role: role as Role };
}

/**
 * Crée le **premier** administrateur de la plateforme.
 *
 * C'est le seul compte que l'application ne sait pas se donner : tout le reste
 * — génération, postes, membres du bureau — se fait ensuite par ses routes,
 * protégées par ce rôle.
 *
 * **Il refuse dès qu'un administrateur existe.** Sans cette garde, l'outil
 * serait un moyen d'en ajouter à volonté, et les administrateurs suivants se
 * nomment par l'application, où chaque ajout laisse une trace.
 *
 * L'adresse est marquée vérifiée : c'est la seule dont personne n'a à prouver
 * qu'il la possède, puisque le compte est créé par celui qui administre le
 * déploiement, pas par un inconnu.
 */
export async function creerPremierAdministrateur(
  users: Repository<User>,
  demande: DemandeAdministrateur,
): Promise<User> {
  const refus = verifierMotDePasse(demande.motDePasse);
  if (refus) {
    throw new RefusCreationAdministrateur(refus);
  }

  if (await users.existsBy({ role: In([...ROLES_INITIAUX]) })) {
    throw new RefusCreationAdministrateur(
      "Un administrateur existe déjà : cet outil ne sert qu'au premier. " +
        "Les suivants se nomment depuis l'application.",
    );
  }

  const email = normaliserEmail(demande.email);
  if (await users.existsBy({ email })) {
    throw new RefusCreationAdministrateur(
      `Un compte existe déjà pour ${email}.`,
    );
  }

  return users.save(
    users.create({
      email,
      passwordHash: await bcrypt.hash(demande.motDePasse, TOURS_BCRYPT),
      firstName: demande.prenom,
      lastName: demande.nom,
      role: demande.role,
      emailVerifieLe: new Date(),
      isActive: true,
    }),
  );
}
