# Déploiement

| Environnement | Branche | Hébergement |
|---|---|---|
| Développement | `develop` | Railway — ce document |
| Recette | `staging` | VPS — **[docs/VPS.md](VPS.md)** |
| Production | `main` | VPS — **[docs/VPS.md](VPS.md)** |

Tout ce qui dépend de l'hébergeur est paramétré par variables
d'environnement : changer d'hébergeur ne demande **aucune ligne de code**,
seulement des valeurs à renseigner. La VPS dispose de sa propre procédure,
outillée dans `deploy/` ; ce document couvre un hébergeur géré comme Railway.

Sur Railway comme derrière tout proxy, poser **`TRUST_PROXY=1`** : sans lui,
tous les visiteurs partagent l'adresse du proxy, donc un seul compteur de
limitation de débit, et quelques tentatives de connexion ferment
l'authentification à tout le monde.

## Ce qui est déjà en place

| Élément | État |
|---|---|
| `Dockerfile` multi-étapes, utilisateur non root, `tini` comme PID 1 | ✅ |
| Écoute sur `0.0.0.0`, port lu depuis `PORT` | ✅ |
| Arrêt propre sur SIGTERM (`enableShutdownHooks`) | ✅ |
| Sonde de santé : `GET /api/v1/health` | ✅ |
| Migrations exécutables sur le code compilé | ✅ |
| Secrets Brevo et R2 cloisonnés par environnement GitHub | ✅ |
| Refus de démarrer sans TLS base, ou avec un secret JWT faible | ✅ |

Le `Dockerfile` est le point important : Render, Railway, Fly.io, Scaleway ou
un simple VPS savent tous en construire un. Le choix d'hébergeur se ramène donc
à fournir des variables.

## Étape 1 — Domaine

Nécessaire pour trois choses à la fois : l'URL de l'API, l'URL publique que
Fapshi appellera pour ses webhooks, et surtout SPF/DKIM sur le domaine
d'envoi des mails.

Sans SPF ni DKIM, les messages de vérification partent en spam chez Gmail et
Outlook. Or **sans message de vérification reçu, aucun compte ne peut être
créé** : c'est toute l'authentification qui tombe, pas seulement le confort.

## Étape 2 — Base de données

Une base PostgreSQL 15 managée (Supabase, Neon, Railway). Relever la chaîne de
connexion en mode *Session*, port 5432.

```
DATABASE_URL=postgresql://...
DATABASE_SSL=true
```

`DATABASE_SSL=true` n'est pas négociable : l'application **refuse de
démarrer** sans lui en production. La connexion porte des données personnelles
d'étudiants et des transactions.

## Étape 3 — Variables d'environnement

À reporter depuis les environnements GitHub (`Settings` → `Environments`) vers
le tableau de bord de l'hébergeur.

| Variable | Origine |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | fourni par l'hébergeur |
| `TRUST_PROXY` | `1` derrière le routeur de l'hébergeur |
| `API_PREFIX` | `api/v1` |
| `CORS_ORIGIN` | URL du frontend, sans barre finale |
| `DATABASE_URL`, `DATABASE_SSL` | étape 2 |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | générés, distincts par environnement |
| `MAIL_*` | Brevo — déjà dans les environnements GitHub |
| `R2_*` | Cloudflare — déjà dans les environnements GitHub |
| `FAPSHI_BASE_URL`, `FAPSHI_API_USER`, `FAPSHI_API_KEY`, `FAPSHI_WEBHOOK_SECRET` | Fapshi — service **live** en production, bac à sable en local et en recette |
| `UPSTASH_REDIS_REST_*` | recommandé : sans eux, la limitation de débit se désactive |

`CORS_ORIGIN` mérite attention : une valeur trop large annule la protection.
Elle accepte plusieurs origines séparées par des virgules, ce qui suffit pour
un frontend et une préproduction.

## Étape 4 — Commande de release

Les migrations ne s'exécutent **pas** automatiquement en production —
`migrationsRun` y est désactivé. C'est voulu : un déploiement à plusieurs
instances les lancerait en parallèle, et l'une échouerait au milieu d'une
transformation de schéma.

Configurer donc une commande de release, jouée une seule fois avant le
basculement :

```bash
node node_modules/typeorm/cli.js migration:run -d dist/config/data-source.js
```

Render l'appelle *Pre-Deploy Command*, Railway *Pre-Deploy Command*, Fly.io
`[deploy] release_command`.

⚠️ **Pas `pnpm run migration:run:prod` dans le conteneur.** L'image
d'exécution ne contient ni pnpm ni corepack — ils n'existent que dans l'étape
de compilation, et n'ont rien à faire dans une image de production. La
commande ci-dessus appelle le CLI TypeORM directement, par un chemin qui, lui,
existe bien dans l'image. Les scripts `migration:*:prod` du `package.json`
suivent désormais la même forme, pour qu'un copier-coller depuis l'un ou
l'autre fonctionne.

En vérifier l'état à tout moment :

```bash
node node_modules/typeorm/cli.js migration:show -d dist/config/data-source.js
```

## Vérifications après la première mise en ligne

1. `GET /api/v1/health` répond `200`.
2. `GET /docs` répond `404` — la documentation est fermée en production, sauf
   `SWAGGER_ENABLED=true`. Elle décrit chemins, charges utiles et rôles
   attendus : une carte offerte à qui cherche une faille.
3. Une inscription avec une adresse `@2027.ucac-icam.com` déclenche bien un
   mail, et il **n'arrive pas en spam**.
4. Les journaux ne montrent aucun avertissement de limitation de débit
   désactivée.

## Le premier administrateur

`pnpm run seed` **lève une erreur si `NODE_ENV=production`** : il lit le mot de
passe dans la configuration, où il resterait dans un fichier, un journal ou une
capture d'écran. Un script de peuplement exécutable en production serait un
compte administrateur créable par quiconque obtient un accès au conteneur.

Le premier administrateur se crée avec un outil dédié, qui demande le mot de
passe au clavier, sans l'afficher, et refuse dès qu'un administrateur existe :

```bash
node dist/seed/creer-admin.js --email <adresse> --prenom <prénom> --nom <nom>
```

Il tourne dans le conteneur, depuis un terminal interactif — jamais avec un mot
de passe en argument ou en variable. Sur la VPS, voir `docs/VPS.md`
§ « Premier administrateur ».
