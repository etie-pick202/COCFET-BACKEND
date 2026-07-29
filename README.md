# COCFET — Backend API

API REST du projet **COCFET**, la plateforme digitale du Bureau des Finissants de l'UCAC-ICAM.

Le front-end vit dans un dépôt séparé : [SOURCING-FRONTEND](https://github.com/FTD237/SOURCING-FRONTEND) (Vite + React + shadcn/ui).

## Stack

| Domaine | Choix |
|---|---|
| Framework | NestJS 11 (TypeScript strict), Node.js ≥ 20 |
| Base de données | PostgreSQL 15 + TypeORM |
| Auth | JWT (`@nestjs/jwt`) + Passport (`passport-jwt`), guards par rôle |
| Sécurité | bcrypt, helmet, rate limiting Upstash Redis |
| Validation | class-validator / class-transformer |
| Emails | `@nestjs-modules/mailer` + nodemailer + Handlebars — Mailtrap (dev), Brevo (prod) |
| Fichiers | Cloudflare R2 (S3-compatible) via `@aws-sdk/client-s3`, URLs signées |
| Documentation | Swagger / OpenAPI (`@nestjs/swagger`) |
| Tests | Jest (unitaires + e2e), Cucumber (BDD) |
| Qualité | ESLint, Prettier, SonarCloud |
| Outillage | pnpm, GitHub Actions |
| Gestion de projet | Jira (tickets `KAN-*`) |

## Démarrage

```bash
pnpm install
cp .env.example .env    # puis renseigner DATABASE_URL et les secrets
pnpm run start:dev
```

- API : `http://localhost:3000/api/v1`
- Documentation Swagger : `http://localhost:3000/docs`
- Healthcheck : `GET /api/v1/health`

En développement, TypeORM synchronise le schéma automatiquement (`synchronize: true`). En production, le schéma est appliqué par migrations.

## Scripts

| Commande | Description |
|---|---|
| `pnpm run start:dev` | Serveur en mode watch |
| `pnpm run build` | Compilation TypeScript |
| `pnpm run lint` | ESLint avec `--fix` |
| `pnpm run lint:check` | ESLint sans correction (utilisé en CI) |
| `pnpm run typecheck` | `tsc --noEmit` |
| `pnpm run test` | Tests unitaires (Jest) |
| `pnpm run test:cov` | Tests unitaires + couverture |
| `pnpm run test:e2e` | Tests end-to-end (nécessite PostgreSQL) |
| `pnpm run test:bdd` | Scénarios BDD (Cucumber) |
| `pnpm run audit:security` | Audit des vulnérabilités (niveau `high`) |

## Architecture

```
src/
├── common/                 # Éléments transverses
│   ├── entities/           # BaseEntity (id, timestamps)
│   ├── enums/              # Role (VISITOR, STUDENT, SPONSOR, ADMIN)
│   └── guards/             # RateLimitGuard (Upstash)
├── config/                 # Configuration TypeORM + validation des variables d'env
└── modules/
    ├── auth/               # JWT, Passport, JwtAuthGuard, RolesGuard, décorateurs
    ├── user/               # Comptes utilisateurs
    ├── generation/         # Générations du bureau, archivage multi-générationnel
    ├── evenement/          # M1 — Événements
    ├── billetterie/        # M1 — Inscriptions, billets QR code
    ├── boutique/           # M2 — Produits (merchandising)
    ├── commande/           # M2 — Commandes et lignes de commande
    ├── paiement/           # Transactions Mobile Money (NotchPay)
    ├── annuaire/           # M3 — Profils des finissants
    ├── sponsor/            # M4 — Sponsors et paliers d'accréditation
    ├── article/            # M5 — Actualités / blog
    ├── sondage/            # M6 — Sondages, options, votes
    ├── notification/       # M7 — Notifications et rappels
    ├── activite/           # Journal d'activité (flux admin en direct)
    ├── mail/               # Envoi d'emails + templates Handlebars
    └── file/               # Stockage Cloudflare R2
```

Les guards `JwtAuthGuard`, `RolesGuard` et `RateLimitGuard` sont appliqués **globalement**. Une route publique se déclare avec le décorateur `@Public()`, une route restreinte avec `@Roles(Role.ADMIN)`.

## Environnements

| Env. | Branche | URL |
|---|---|---|
| Développement | `feat/*` | `localhost:3000` |
| Staging | `staging` | `api-staging.cocfet.com` |
| Production | `main` | `api.cocfet.com` |

## Contribuer

Modèle de branches, conventions de commit et processus de PR : voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Configuration restante (manuelle)

- **SonarCloud** : créer le projet sur [sonarcloud.io](https://sonarcloud.io), ajouter le secret `SONAR_TOKEN` et la variable `SONAR_ENABLED=true`, puis corriger `sonar.organization` dans `sonar-project.properties`.
- **Upstash** : créer une base Redis et renseigner `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (sans ça, le rate limiting reste désactivé).
- **Cloudflare R2** et **Brevo/Mailtrap** : renseigner les variables correspondantes dans `.env`.
