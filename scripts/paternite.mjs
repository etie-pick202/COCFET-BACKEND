#!/usr/bin/env node
/**
 * Garde la paternité des commits entre les mains de l'équipe.
 *
 * Les outils d'assistance ajoutent volontiers leur propre signature au bas des
 * messages de commit — un pied « Co-authored-by » à leur nom, une ligne
 * annonçant qu'ils ont produit le changement. GitHub compte ces pieds : le
 * co-auteur apparaît sur le commit et rejoint les contributeurs du dépôt. Le
 * bureau a tranché : les contributeurs de ce dépôt sont les personnes qui y
 * travaillent, et elles seules.
 *
 * Le contrôle est délibérément **écrit en négatif** : aucun outil n'est nommé
 * ici. Une liste de noms proscrits serait à la fois une mention de plus dans le
 * dépôt — précisément ce qu'on cherche à éviter — et une course perdue
 * d'avance, chaque nouvel outil signant à sa façon. On autorise donc, et tout
 * le reste tombe.
 *
 * Deux emplois :
 *
 *   node scripts/paternite.mjs --nettoyer <fichier-message>
 *       Retire les signatures d'outil du message. Appelé par le crochet
 *       « commit-msg », avant commitlint.
 *
 *   node scripts/paternite.mjs --verifier <base> [sommet]
 *       Refuse la plage si un commit porte une signature d'outil, ou s'il est
 *       signé par une identité inconnue. Appelé par l'intégration continue,
 *       seul endroit qu'on ne peut pas contourner avec « --no-verify ».
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Adresses autorisées à figurer comme auteur, committeur ou co-auteur.
 *
 * **Pour accueillir quelqu'un**, ajoutez son adresse ici — celle que git
 * inscrit dans ses commits, que `git log --format=%ae` affiche. Sans cela sa
 * première contribution sera refusée par l'intégration continue, avec le motif
 * en clair.
 */
const CONTRIBUTEURS = new Set([
  'etienne.mayack@2027.ucac-icam.com',
  'mmayack900@gmail.com',
  '147406012+logan496@users.noreply.github.com',
  '49699333+dependabot[bot]@users.noreply.github.com',
  // Committeur de toute fusion faite depuis l'interface de GitHub. Ce n'est
  // pas quelqu'un : c'est la forge qui signe l'operation a la place de la
  // personne qui a clique. L'omettre refuserait toute PR contenant une fusion.
  'noreply@github.com',
]);

/** Un pied de co-paternité, quelle qu'en soit la casse. */
const MOTIF_COAUTEUR = /^co-authored-by:\s*(.*?)\s*<([^>]+)>\s*$/i;

/**
 * Lignes par lesquelles un outil s'attribue le changement.
 *
 * Volontairement structurelles plutôt que nominatives : c'est la **forme** de
 * la signature qui est reconnue — un emoji de robot en tête de ligne, une
 * annonce de génération — et non l'outil qui la pose.
 */
const MOTIFS_SIGNATURE = [
  /^\s*\u{1F916}/u,
  /^\s*generated with\b/i,
  /^\s*(co-)?(authored|generated|written) by [^<]*\b(ai|bot|assistant)\b/i,
];

/** Vrai si la ligne est une signature d'outil, ou un pied non autorisé. */
function estSignatureDOutil(ligne) {
  if (MOTIFS_SIGNATURE.some((motif) => motif.test(ligne))) {
    return true;
  }

  const coauteur = MOTIF_COAUTEUR.exec(ligne);

  return coauteur !== null && !CONTRIBUTEURS.has(coauteur[2].toLowerCase());
}

/**
 * Rend le message débarrassé de ses signatures.
 *
 * Les lignes vides laissées derrière sont refermées : un message terminé par
 * trois retours à la ligne est refusé par commitlint, et l'auteur chercherait
 * longtemps pourquoi.
 */
export function nettoyer(message) {
  const retenues = message.split(/\r?\n/).filter(
    // Les lignes de commentaire appartiennent au gabarit de git : elles ne
    // partent pas dans le message, inutile d'y toucher.
    (ligne) => ligne.startsWith('#') || !estSignatureDOutil(ligne),
  );

  return `${retenues.join('\n').trimEnd()}\n`;
}

function commandeGit(arguments_) {
  return execFileSync('git', arguments_, { encoding: 'utf8' });
}

/**
 * Contrôle une plage de commits.
 *
 * Rend la liste des reproches, vide si tout va bien. La plage est celle de la
 * demande de fusion — jamais l'historique entier : les commits déjà publiés ne
 * se réécrivent pas, et les refuser bloquerait toute PR pour un passé qu'on a
 * choisi de laisser tel quel.
 */
export function verifierPlage(base, sommet = 'HEAD') {
  // Séparateurs non imprimables : un message de commit peut contenir tout
  // caractère visible, y compris celui qu'on aurait choisi comme délimiteur.
  const CHAMP = '\u001f';
  const ENREGISTREMENT = '\u0000';

  const journal = commandeGit([
    'log',
    `${base}..${sommet}`,
    '--format=%H%x1f%ae%x1f%ce%x1f%B%x00',
  ]);

  const reproches = [];

  for (const bloc of journal.split(ENREGISTREMENT)) {
    if (!bloc.trim()) {
      continue;
    }

    const [empreinte, auteur, committeur, corps = ''] = bloc
      .replace(/^\r?\n/, '')
      .split(CHAMP);
    const court = empreinte.slice(0, 8);

    for (const [role, adresse] of [
      ['auteur', auteur],
      ['committeur', committeur],
    ]) {
      if (adresse && !CONTRIBUTEURS.has(adresse.toLowerCase())) {
        reproches.push(
          `${court} : ${role} inconnu « ${adresse} ». Si cette personne ` +
            'rejoint le projet, ajoutez son adresse à CONTRIBUTEURS dans ' +
            'scripts/paternite.mjs.',
        );
      }
    }

    for (const ligne of corps.split(/\r?\n/)) {
      if (estSignatureDOutil(ligne)) {
        reproches.push(`${court} : signature d’outil « ${ligne.trim()} ».`);
      }
    }
  }

  return reproches;
}

function principal() {
  const [mode, ...parametres] = process.argv.slice(2);

  if (mode === '--nettoyer') {
    const chemin = parametres[0];
    const avant = readFileSync(chemin, 'utf8');
    const apres = nettoyer(avant);

    if (avant !== apres) {
      writeFileSync(chemin, apres);
      console.log('Signature d’outil retirée du message de commit.');
    }
    return;
  }

  if (mode === '--verifier') {
    const reproches = verifierPlage(parametres[0], parametres[1]);

    if (reproches.length > 0) {
      console.error('Paternité des commits refusée :\n');
      for (const reproche of reproches) {
        console.error(`  - ${reproche}`);
      }
      console.error(
        '\nLes contributeurs de ce dépôt sont les personnes qui y travaillent.',
      );
      process.exit(1);
    }

    console.log('Paternité des commits vérifiée.');
    return;
  }

  console.error(
    'Emploi : paternite.mjs --nettoyer <fichier> | --verifier <base> [sommet]',
  );
  process.exit(2);
}

// Ne s'exécute que lancé en ligne de commande : les tests importent les
// fonctions sans déclencher de sortie de processus.
if (process.argv[1]?.endsWith('paternite.mjs')) {
  principal();
}
