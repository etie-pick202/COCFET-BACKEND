# COCFET — Backend API

API REST du projet **COCFET**, la plateforme digitale du Bureau des Finissants de l'UCAC-ICAM.

Le front-end vit dans un dépôt séparé : [SOURCING-FRONTEND](https://github.com/FTD237/SOURCING-FRONTEND) (Vite + React + shadcn/ui).

## Stack

| Élément | Choix |
|---|---|
| Framework | NestJS 11 (TypeScript) |
| ORM | Prisma |
| Base de données | PostgreSQL (Supabase) |
| Validation | class-validator / class-transformer |
| Auth | JWT (access + refresh) + SSO UCAC-ICAM |
| Paiement | NotchPay |
| Emails / Push | Resend / Firebase FCM |
| CI/CD | GitHub Actions + SonarCloud |

## Démarrage

```bash
npm install
cp .env.example .env    # puis renseigner DATABASE_URL et les secrets
npx prisma migrate dev
npm run start:dev
```

L'API écoute par défaut sur `http://localhost:3000/api/v1`.

## Scripts utiles

| Commande | Description |
|---|---|
| `npm run start:dev` | Serveur en mode watch |
| `npm run build` | Compilation TypeScript |
| `npm run lint` | ESLint (avec `--fix`) |
| `npm run test` | Tests unitaires (Jest) |
| `npm run test:e2e` | Tests end-to-end |
| `npm run prisma:migrate` | Créer/appliquer une migration en dev |
| `npm run prisma:studio` | Explorer la base de données |
| `npm run prisma:seed` | Injecter les données de seed |

## Modules fonctionnels prévus

| Code | Module |
|---|---|
| M1 | Événements & Billetterie |
| M2 | Boutique / Merchandising |
| M3 | Annuaire des Finissants |
| M4 | Espace Sponsors |
| M5 | Actualités / Blog |
| M6 | Sondages & Votes |
| M7 | Notifications & Rappels |

Modules transversaux : Authentification & comptes, Dashboard d'administration, système multi-générationnel.

## Environnements

| Env. | Branche | URL |
|---|---|---|
| Développement | `feature/*` | `localhost:3000` |
| Preview | PR | déploiement éphémère |
| Staging | `staging` | `api-staging.cocfet.com` |
| Production | `main` | `api.cocfet.com` |

## Contribuer

Le modèle de branches, les conventions de commit (Conventional Commits) et le processus de Pull Request sont décrits dans [CONTRIBUTING.md](CONTRIBUTING.md).

## Configuration restante (à faire manuellement)

- Créer le projet sur [SonarCloud](https://sonarcloud.io), puis ajouter le secret `SONAR_TOKEN` dans les secrets GitHub Actions et corriger `sonar.organization` dans `sonar-project.properties`.
- Appliquer la protection des branches : `./scripts/setup-branch-protection.sh <owner>/<repo>`.
