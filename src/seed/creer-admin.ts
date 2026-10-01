import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import sourceDeDonnees from '../config/data-source';
import {
  creerPremierAdministrateur,
  lireArgumentsAdministrateur,
  RefusCreationAdministrateur,
  verifierMotDePasse,
} from '../modules/user/administrateur-initial';
import { User } from '../modules/user/entities/user.entity';

/**
 * Crée le premier administrateur.
 *
 *   node dist/seed/creer-admin.js --email <adresse> --prenom <prénom> --nom <nom>
 *
 * Joué dans le conteneur, en production comme en recette — là où `seed.ts`
 * refuse de s'exécuter, parce qu'il lit le mot de passe dans la configuration :
 * une valeur qui reste dans un fichier, un journal, une capture d'écran.
 * Ici le mot de passe se saisit au clavier, sans écho, et n'est écrit nulle
 * part. La logique, et la garde qui refuse dès qu'un administrateur existe,
 * sont dans modules/user/administrateur-initial.ts.
 */

/** Lit une ligne au clavier sans la répéter à l'écran. */
function lireSansEcho(question: string): Promise<string> {
  return new Promise((resoudre) => {
    let muet = false;
    // Le terminal affiche chaque frappe : cette sortie les avale une fois la
    // question posée, sans quoi le mot de passe s'écrirait en clair.
    const sortie = new Writable({
      write(morceau: Buffer, _encodage, termine) {
        if (!muet) {
          process.stdout.write(morceau);
        }
        termine();
      },
    });
    const lecteur = createInterface({
      input: process.stdin,
      output: sortie,
      terminal: true,
    });

    process.stdout.write(question);
    muet = true;
    lecteur.question('', (reponse) => {
      lecteur.close();
      process.stdout.write('\n');
      resoudre(reponse);
    });
  });
}

async function principal(): Promise<void> {
  const demande = lireArgumentsAdministrateur(process.argv.slice(2));

  // Sans terminal, le mot de passe viendrait d'un tube ou d'un fichier : il
  // passerait par la ligne de commande ou l'historique, ce que cet outil
  // existe pour éviter.
  if (!process.stdin.isTTY) {
    throw new RefusCreationAdministrateur(
      'Cet outil demande le mot de passe au clavier : le lancer depuis un ' +
        'terminal interactif, sans redirection.',
    );
  }

  const motDePasse = await lireSansEcho('Mot de passe : ');
  const refus = verifierMotDePasse(motDePasse);
  if (refus) {
    throw new RefusCreationAdministrateur(refus);
  }
  if (motDePasse !== (await lireSansEcho('Confirmez le mot de passe : '))) {
    throw new RefusCreationAdministrateur('Les deux saisies diffèrent.');
  }

  const source = await sourceDeDonnees.initialize();
  try {
    const cree = await creerPremierAdministrateur(source.getRepository(User), {
      ...demande,
      motDePasse,
    });
    console.log(`Administrateur créé : ${cree.email} (${cree.role}).`);
  } finally {
    await source.destroy();
  }
}

void principal().catch((erreur: unknown) => {
  // Un refus attendu s'affiche seul ; le reste garde sa trace, pour le
  // diagnostic.
  if (erreur instanceof RefusCreationAdministrateur) {
    console.error(erreur.message);
  } else {
    console.error(erreur);
  }
  process.exit(1);
});
