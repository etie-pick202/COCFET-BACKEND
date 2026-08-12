import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nettoyer } from './paternite.mjs';

/**
 * Éprouvé avec le lanceur de Node plutôt qu'avec Jest : la configuration Jest
 * du projet a `src` pour racine et ne ramasse que les `.spec.ts`. Y faire
 * entrer un script d'outillage écrit en module ES coûterait plus cher que ces
 * quelques assertions.
 */

const MESSAGE = [
  "fix(mail): envoyer par l'API HTTP Brevo",
  '',
  'Railway filtre les ports SMTP sortants.',
].join('\n');

test('retire un pied de co-paternité inconnu', () => {
  const avec = `${MESSAGE}\n\nCo-Authored-By: Un Outil <noreply@exemple-outil.test>\n`;

  assert.equal(nettoyer(avec), `${MESSAGE}\n`);
});

test('retire la ligne annonçant une génération', () => {
  const avec = `${MESSAGE}\n\n\u{1F916} Generated with [Un Outil](https://exemple.test)\n`;

  assert.equal(nettoyer(avec), `${MESSAGE}\n`);
});

test('reconnaît le pied quelle que soit la casse', () => {
  // Les outils écrivent « Co-authored-by », « Co-Authored-By »… La casse d'un
  // pied de commit n'est pas normalisée, le contrôle ne doit pas s'y fier.
  const avec = `${MESSAGE}\n\nco-authored-by: Un Outil <noreply@exemple-outil.test>\n`;

  assert.equal(nettoyer(avec), `${MESSAGE}\n`);
});

test('conserve un pied de co-paternité autorisé', () => {
  // Deux personnes du bureau qui pratiquent la programmation en binôme ont le
  // droit de se partager un commit.
  const pied = 'Co-authored-by: logan496 <147406012+logan496@users.noreply.github.com>';
  const avec = `${MESSAGE}\n\n${pied}\n`;

  assert.equal(nettoyer(avec), avec);
});

test('ne touche pas à un message déjà propre', () => {
  assert.equal(nettoyer(`${MESSAGE}\n`), `${MESSAGE}\n`);
});

test('laisse les commentaires du gabarit de git', () => {
  // Git les retire lui-même ; les filtrer ici ferait diverger le message de ce
  // que l'auteur a sous les yeux dans son éditeur.
  const avec = `${MESSAGE}\n\n# Sur la branche develop\n`;

  assert.match(nettoyer(avec), /# Sur la branche develop/);
});

test('ne laisse pas trois retours à la ligne derrière lui', () => {
  // commitlint refuse un message qui se termine ainsi, et l'auteur chercherait
  // longtemps pourquoi son commit est rejeté.
  const avec = `${MESSAGE}\n\n\u{1F916} Generated with [Un Outil](https://exemple.test)\n\n`;

  assert.doesNotMatch(nettoyer(avec), /\n{3}$/);
});
