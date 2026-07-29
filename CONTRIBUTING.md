# Contribuer au backend COCFET

Ce document décrit le modèle de branches, les conventions de commit et le processus de Pull Request pour ce dépôt.

## 1. Modèle de branches

| Branche | Rôle | Protégée | Déploiement |
|---|---|---|---|
| `main` | Code de production, toujours stable | Oui | `api.cocfet.com` |
| `staging` | Pré-production, recette avant merge sur `main` | Oui | `api-staging.cocfet.com` |
| `develop` | Intégration continue des features validées | Oui | environnement de dev |
| `feat/<KAN-xx>-<description>` | Nouvelle fonctionnalité | Non | Preview (PR) |
| `fix/<KAN-xx>-<description>` | Correction de bug | Non | Preview (PR) |
| `hotfix/<description>` | Correction urgente sur `main` | Non | Preview (PR) |
| `chore/<description>` | Tâches techniques (CI, deps, config) | Non | Preview (PR) |

**Flux de promotion :** `feat/*` → `develop` → `staging` → `main`.

- Toute nouvelle fonctionnalité part de `develop` : `git checkout -b feat/KAN-12-auth-jwt develop`.
- Un `hotfix/*` part de `main` et est reporté sur `staging` et `develop`.
- Jamais de merge direct `feat/*` → `main`.
- Aucun push direct sur `main`, `staging` ou `develop` : tout passe par une Pull Request.

### Exemples de nommage

```
feat/KAN-24-annuaire-filtres
fix/KAN-31-refresh-token-expiration
hotfix/cors-production
```

## 2. Gestion de projet (Jira)

Chaque branche et chaque PR sont rattachées à un ticket Jira `KAN-*`. La référence du ticket doit apparaître :

- dans le **nom de la branche** (`feat/KAN-24-...`) ;
- dans le **footer du commit** (`Refs: KAN-24`) ;
- dans la **description de la PR**.

## 3. Convention de commits — Conventional Commits

```
<type>(<scope optionnel>): <description courte à l'impératif>

[corps optionnel]

Refs: KAN-24
```

**Types autorisés :**

| Type | Usage |
|---|---|
| `feat` | Nouvelle fonctionnalité |
| `fix` | Correction de bug |
| `docs` | Documentation uniquement |
| `style` | Formatage, pas de changement de logique |
| `refactor` | Refactoring sans changement de comportement |
| `perf` | Amélioration de performance |
| `test` | Ajout/modification de tests |
| `build` | Build system, dépendances |
| `ci` | Configuration CI/CD |
| `chore` | Tâches diverses (config, tooling) |
| `revert` | Annulation d'un commit précédent |

**Exemples :**

```
feat(auth): ajouter le refresh token
fix(offre): corriger le filtre par date d'expiration
ci(workflows): ajouter le job cucumber
```

Les commits sont validés par **commitlint** via un hook `commit-msg` (Husky) : un message non conforme est rejeté localement.

## 4. Pull Requests

- Une PR par sujet, la plus petite possible.
- Titre au format Conventional Commits (ex : `feat(annuaire): filtrer les finissants par filière`).
- Description remplie via `.github/PULL_REQUEST_TEMPLATE.md`, avec la référence Jira.
- Toutes les vérifications CI doivent passer : **Lint, Type check, Unit tests, E2E tests, BDD (Cucumber), Security audit, Build** (+ SonarCloud une fois activé).
- **Au moins 1 review approuvée** avant merge.
- Stratégie de merge : **Squash and merge**. La branche est supprimée après merge.

## 5. Push

- Jamais de `git push --force` sur `main`, `staging` ou `develop` (bloqué par la protection de branche).
- `--force-with-lease` toléré sur une branche personnelle avant ouverture de la PR.
- Les secrets (`.env`, clés API, tokens) ne doivent jamais être commités — voir `.env.example`.

## 6. Qualité de code

- ESLint + Prettier vérifiés en CI et via le hook `pre-commit` (lint-staged).
- TypeScript en mode **strict** : `pnpm run typecheck` doit passer sans erreur.
- Tests unitaires (Jest) et scénarios BDD (Cucumber) pour toute nouvelle logique métier.
- `pnpm run audit:security` ne doit remonter aucune vulnérabilité de niveau `high` ou supérieur. Les CVE transitives se corrigent via le champ `overrides` du `package.json`.
- SonarCloud analyse la couverture et les code smells sur chaque PR.

## 7. Environnement de développement

```bash
pnpm install
cp .env.example .env    # renseigner DATABASE_URL et les secrets
pnpm run start:dev
```

Le gestionnaire de paquets est **pnpm** — ne pas utiliser `npm install` (le lockfile `pnpm-lock.yaml` fait foi).
