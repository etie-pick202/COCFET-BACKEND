# Contribuer au backend COCFET

Ce document décrit le modèle de branches, les conventions de commit et le processus de Pull Request pour ce dépôt.

## 1. Modèle de branches (Git Flow simplifié)

| Branche | Rôle | Protégée | Déploiement |
|---|---|---|---|
| `main` | Code de production, toujours stable | Oui | `api.cocfet.com` (auto-deploy) |
| `develop` | Intégration continue des features validées | Oui | `api-staging.cocfet.com` (si `staging` absent) |
| `staging` | Pré-production, recette avant merge sur `main` | Oui | `api-staging.cocfet.com` |
| `feature/<ticket>-<description>` | Nouvelle fonctionnalité | Non | Preview (PR) |
| `fix/<ticket>-<description>` | Correction de bug (non urgente) | Non | Preview (PR) |
| `hotfix/<description>` | Correction urgente sur `main` | Non | Preview (PR) |
| `release/<version>` | Préparation d'une release (freeze, changelog) | Non | - |
| `chore/<description>` | Tâches techniques (CI, deps, config) | Non | Preview (PR) |

**Règles de flux :**
- Toute nouvelle fonctionnalité part de `develop` : `git checkout -b feature/12-auth-jwt develop`.
- Un `hotfix/*` part de `main` et est mergé à la fois dans `main` **et** `develop`/`staging`.
- `develop` → `staging` → `main` : promotion progressive, jamais de merge direct `feature/*` → `main`.
- Aucun push direct sur `main`, `develop` ou `staging` : tout passe par une Pull Request.

### Exemple de nommage de branche

```
feature/24-integration-notchpay
fix/31-jwt-refresh-expiration
hotfix/webhook-signature-check
release/1.2.0
```

## 2. Convention de commits — Conventional Commits

Chaque commit doit respecter le format :

```
<type>(<scope optionnel>): <description courte à l'impératif>

[corps optionnel]

[footer optionnel, ex: Closes #12]
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
feat(auth): ajouter le flux SSO UCAC-ICAM
fix(payments): corriger le double webhook NotchPay
ci(workflows): ajouter le job de type-check
```

Les commits sont validés automatiquement par **commitlint** via un hook `commit-msg` (Husky). Un commit qui ne respecte pas le format est rejeté localement.

## 3. Pull Requests

- Une PR par sujet fonctionnel/technique, la plus petite possible pour faciliter la revue.
- Titre de la PR au format Conventional Commits (ex: `feat(events): ajouter l'inscription avec jauge temps réel`).
- La description doit utiliser le template `.github/PULL_REQUEST_TEMPLATE.md`.
- Toutes les vérifications CI doivent passer (lint, type-check, tests, build, SonarCloud) avant merge.
- **Au moins 1 review approuvée** est requise avant merge (2 si la PR touche `main` en hotfix).
- Merge stratégie : **Squash and merge** vers `develop`/`staging`, pour garder un historique `main` lisible.
- Supprimer la branche après merge.

## 4. Push

- Jamais de `git push --force` sur `main`, `develop` ou `staging`.
- `--force-with-lease` toléré uniquement sur une branche `feature/*` personnelle, avant ouverture de la PR.
- Les secrets (`.env`, clés API, tokens) ne doivent jamais être commités — voir `.env.example` pour la liste des variables attendues.

## 5. Qualité de code

- Le linting (ESLint) et le formatage (Prettier) sont vérifiés en CI et via un hook `pre-commit` (lint-staged).
- Le type-check TypeScript (`tsc --noEmit`) doit passer sans erreur.
- La couverture de tests et les "code smells" sont analysés par SonarCloud sur chaque PR (voir `sonar-project.properties`).
- Toute nouvelle route/service doit être accompagnée de tests unitaires (Jest, fourni par NestJS).
