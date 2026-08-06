import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { Role } from '../common/enums/role.enum';
import { normaliserEmail } from '../common/identite/identite-campus';
import sourceDeDonnees from '../config/data-source';
import { PosteBureau } from '../modules/bureau/entities/poste-bureau.entity';
import { Generation } from '../modules/generation/entities/generation.entity';
import { User } from '../modules/user/entities/user.entity';

const TOURS_BCRYPT = 12;

const ADMIN = {
  email: 'etiennemayack65@gmail.com',
  prenom: 'Etienne',
  nom: 'Mayack',
};

const GENERATION_INITIALE = {
  annee: 2027,
  // Nom du bureau COCFET, pas un libelle de promotion : une generation est le
  // mandat d'un bureau, et c'est ce nom que la plateforme affiche.
  nom: 'ATLAS',
  couleurPrimaire: '#0F172A',
  couleurSecondaire: '#D4AF37',
};

/**
 * Postes minimaux d'un bureau COCFET.
 *
 * Le catalogue reste modifiable par l'administration — chaque mandat
 * s'organise a sa facon. Ces trois-la sont marques cles : sans eux, une
 * generation ne peut pas etre activee, et la plateforme basculerait sur un
 * bureau qui n'existe pas.
 *
 * La presidence accorde l'administration : c'est par elle que la passation se
 * fait d'un mandat au suivant.
 */
const POSTES_INITIAUX = [
  {
    nom: 'President',
    ordre: 1,
    estCle: true,
    accordeAdministration: true,
    description: 'Represente le bureau et pilote la plateforme.',
  },
  {
    nom: 'Vice-president',
    ordre: 2,
    estCle: true,
    accordeAdministration: true,
    description: 'Seconde la presidence et la supplee.',
  },
  {
    nom: 'Secretaire',
    ordre: 3,
    estCle: true,
    accordeAdministration: false,
    description: 'Tient les comptes rendus et la correspondance.',
  },
];

/**
 * Jeu de données minimal pour démarrer.
 *
 * Contient uniquement ce qui ne peut pas être créé par l'application
 * elle-même : la première génération, et le premier administrateur. Aucun
 * compte étudiant n'est créé — ils doivent suivre le parcours normal
 * d'inscription, seul moyen de vérifier que ce parcours fonctionne.
 *
 * Idempotent : deux exécutions ne produisent aucun doublon.
 */
async function semer(source: DataSource): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      "Le seed ne doit jamais s'exécuter en production : il crée un compte " +
        'administrateur dont le mot de passe provient de la configuration.',
    );
  }

  const motDePasseAdmin = process.env.SEED_ADMIN_PASSWORD;
  if (!motDePasseAdmin) {
    throw new Error(
      'SEED_ADMIN_PASSWORD est requis. Le mot de passe administrateur n’est ' +
        'volontairement pas inscrit dans le code : ce dépôt est public, et un ' +
        'mot de passe commité vaudrait pour tout environnement ayant joué ce seed.',
    );
  }

  const generations = source.getRepository(Generation);
  const users = source.getRepository(User);

  let generation = await generations.findOne({
    where: { annee: GENERATION_INITIALE.annee },
  });
  if (!generation) {
    generation = await generations.save(
      generations.create({ ...GENERATION_INITIALE, isActive: true, stats: {} }),
    );
    console.log(`Génération créée : ${generation.nom}`);
  } else {
    console.log(`Génération déjà présente : ${generation.nom}`);
  }

  const postes = source.getRepository(PosteBureau);
  for (const definition of POSTES_INITIAUX) {
    const existant = await postes.findOne({ where: { nom: definition.nom } });
    if (!existant) {
      await postes.save(postes.create(definition));
      console.log(`Poste cree : ${definition.nom}`);
    }
  }

  const emailAdmin = normaliserEmail(ADMIN.email);
  const existant = await users.findOne({ where: { email: emailAdmin } });

  if (existant) {
    console.log(`Administrateur déjà présent : ${emailAdmin}`);
    return;
  }

  await users.save(
    users.create({
      email: emailAdmin,
      passwordHash: await bcrypt.hash(motDePasseAdmin, TOURS_BCRYPT),
      firstName: ADMIN.prenom,
      lastName: ADMIN.nom,
      role: Role.ADMIN,
      // Le seul compte dont l'adresse n'a pas à être prouvée : il est créé
      // par la personne qui administre le déploiement, pas par un inconnu.
      emailVerifieLe: new Date(),
      isActive: true,
    }),
  );
  console.log(`Administrateur créé : ${emailAdmin}`);
}

async function principal(): Promise<void> {
  const source = await sourceDeDonnees.initialize();
  try {
    await semer(source);
    console.log('Seed terminé.');
  } finally {
    await source.destroy();
  }
}

void principal().catch((erreur: unknown) => {
  console.error(erreur instanceof Error ? erreur.message : erreur);
  process.exit(1);
});
