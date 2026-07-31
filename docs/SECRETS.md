# Identifiants et secrets

Ce document décrit, pour chaque secret du projet : **comment l'obtenir**, **où le saisir**, et **quand il devient nécessaire**.

## Règles

1. **Aucun secret n'est commité.** `.env` est ignoré par git ; seul `.env.example` (valeurs vides) est versionné.
2. **Aucun secret ne transite par un canal de discussion** (chat, WhatsApp, mail, ticket Jira). Un secret partagé dans une conversation doit être considéré comme compromis et régénéré.
3. **On ne partage jamais un mot de passe de compte.** Chaque service émet des identifiants d'API dédiés, à portée limitée et révocables individuellement.
4. **Chaque environnement a ses propres identifiants.** Ceux de développement ne sont jamais réutilisés en production.

## Saisie assistée

Le script suivant lit les valeurs au clavier **sans les afficher**, les écrit dans `.env` et, avec `--github`, les pousse dans les secrets GitHub Actions :

```bash
./scripts/setup-secrets.sh
```

## Où saisir quoi

| Destination | Usage | Comment |
|---|---|---|
| `.env` (local) | Développement sur votre machine | `./scripts/setup-secrets.sh` ou édition manuelle |
| **Secrets** GitHub Actions | Valeurs sensibles utilisées par la CI | `gh secret set NOM --repo etie-pick202/COCFET-BACKEND` |
| **Variables** GitHub Actions | Valeurs non sensibles (drapeaux, clés publiques) | `gh variable set NOM --body "valeur" --repo ...` |
| Variables d'environnement de l'hébergeur | Production (Render / Railway) | Dashboard du service > Environment |

> `gh secret set` sans `--body` lit la valeur sur l'entrée standard : elle n'apparaît ni à l'écran ni dans l'historique du shell.

---

## Inventaire

### Base de données — `DATABASE_URL`

- **Développement** : PostgreSQL local. Format `postgresql://postgres:<mot-de-passe>@localhost:5432/cocfet_dev`.
- **Production** : Supabase > *Project Settings* > *Database* > *Connection string* (mode **Session**, port 5432). Mettre `DATABASE_SSL=true`.
- **Où** : `.env` en local ; variables d'environnement de l'hébergeur en production.
- **Nécessaire** : immédiatement.

### Authentification — `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`

Ces valeurs ne s'obtiennent nulle part : **on les génère soi-même**, différentes par environnement.

```bash
openssl rand -base64 48
```

- **Où** : `.env` en local ; variables d'environnement de l'hébergeur en production.
- **Nécessaire** : immédiatement.
- ⚠️ Changer ces secrets invalide tous les tokens en circulation et déconnecte tous les utilisateurs.

### SSO UCAC-ICAM — `UCAC_OAUTH_CLIENT_ID`, `UCAC_OAUTH_CLIENT_SECRET`, `UCAC_OAUTH_CALLBACK_URL`

- **Obtention** : auprès du service informatique de l'UCAC-ICAM. Il faut leur communiquer l'URL de callback à autoriser (`https://api.cocfet.com/api/v1/auth/ucac-callback` en production, `http://localhost:3000/api/v1/auth/ucac-callback` en développement).
- **Où** : `.env` et hébergeur.
- **Nécessaire** : à l'implémentation de la connexion UCAC-ICAM.

### Limitation de débit — `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

1. [console.upstash.com](https://console.upstash.com) > **Redis** > créer une base (région la plus proche, plan *Free*).
2. Ouvrir la base > onglet **REST API**.
3. Copier `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`.

- **Où** : `.env` et hébergeur.
- **Nécessaire** : optionnel. Sans ces valeurs, `RateLimitGuard` se désactive et journalise un avertissement au démarrage — pratique en local, à ne pas laisser en production.

### Stockage de fichiers — `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`

1. [dash.cloudflare.com](https://dash.cloudflare.com) > **R2** > **Create bucket** (ex. `cocfet-dev` et `cocfet-prod`).
2. **R2** > **Manage API tokens** > **Create API token**.
3. Permission **Object Read & Write**, restreinte au bucket concerné.
4. Récupérer `Access Key ID` et `Secret Access Key` — **le secret n'est affiché qu'une seule fois**.
5. L'endpoint est `https://<account-id>.r2.cloudflarestorage.com` ; l'`account-id` figure dans l'URL du dashboard.

- **Où** : `.env` et hébergeur.
- **Nécessaire** : à l'implémentation des uploads (photos de profil, CV, images produits).

### Emails — `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`

**Développement — Mailpit : aucun identifiant à obtenir**

Mailpit capture localement tout ce que l'API envoie et n'expédie rien vers l'extérieur. Pas de compte, pas de quota, fonctionne hors ligne.

**Docker n'est pas obligatoire** — Mailpit est un binaire autonome. Choisissez l'une des deux méthodes :

*Option A — binaire autonome (aucune dépendance)*

Télécharger l'exécutable correspondant à votre système depuis les [releases officielles](https://github.com/axllent/mailpit/releases) (`mailpit-windows-amd64.zip` sous Windows), le décompresser, puis :

```bash
./mailpit
```

*Option B — Docker*

```bash
docker compose up -d
```

Les valeurs sont déjà celles de `.env.example`, il n'y a rien à saisir :

| Variable | Valeur |
|---|---|
| `MAIL_HOST` | `localhost` |
| `MAIL_PORT` | `1025` |
| `MAIL_USER` | *(vide)* |
| `MAIL_PASSWORD` | *(vide)* |

Les emails capturés se consultent sur **http://localhost:8025**.

> Le module mail omet le bloc `auth` lorsque `MAIL_USER` et `MAIL_PASSWORD` sont vides : envoyer des identifiants vides ferait échouer la négociation SMTP avec Mailpit.

**Staging et production — Brevo**

1. [app.brevo.com](https://app.brevo.com) > menu utilisateur > **SMTP & API** > onglet **SMTP**.
2. Relever le serveur (`smtp-relay.brevo.com`), le port (`587`) et le login.
3. **Generate a new SMTP key** — la clé sert de `MAIL_PASSWORD`.
4. Valider le domaine d'envoi : **Senders, Domains & Dedicated IPs** > ajouter le domaine > publier les enregistrements DNS **SPF** et **DKIM** fournis.

- **Où** : variables d'environnement de l'hébergeur. Inutile de renseigner Brevo dans `.env` en local, Mailpit y suffit.
- **Nécessaire** : au déploiement en staging.
- ⚠️ **Sans SPF ni DKIM, les emails partent en spam**, quel que soit le fournisseur — Gmail et Outlook ont durci leurs règles. Cette étape n'est pas optionnelle.

**Pourquoi Mailpit plutôt qu'un bac à sable hébergé**

| | Mailpit | Mailtrap (gratuit) |
|---|---|---|
| Compte à créer | Non | Oui |
| Quota | Illimité | 100 emails/mois |
| Fonctionne hors ligne | Oui | Non |
| Identifiants à partager dans l'équipe | Aucun | Oui |

### Paiement — `NOTCHPAY_PUBLIC_KEY`, `NOTCHPAY_SECRET_KEY`, `NOTCHPAY_WEBHOOK_SECRET`

1. [business.notchpay.co](https://business.notchpay.co) > **Settings** > **API Keys**.
2. Relever la clé publique et la clé secrète. Utiliser les clés de **test** tant que la plateforme n'est pas en production.
3. **Settings** > **Webhooks** > ajouter `https://api.cocfet.com/api/v1/webhooks/notchpay` et relever le secret de signature.

- **Où** : `.env` et hébergeur.
- **Nécessaire** : à l'implémentation du paiement Mobile Money.
- ⚠️ `NOTCHPAY_WEBHOOK_SECRET` est indispensable : il permet de vérifier la signature des webhooks. Sans cette vérification, n'importe qui pourrait appeler l'endpoint et faire passer une commande en « payée ».

### Analyse de code — `SONAR_TOKEN` *(configuré)*

1. [sonarcloud.io](https://sonarcloud.io) > avatar > **My Account** > **Security**.
2. Saisir un nom, **Generate Token**, copier la valeur (affichée une seule fois).

- **Où** : **uniquement** dans les secrets GitHub Actions — jamais dans `.env`, l'analyse ne tourne qu'en CI.
- **Nécessaire** : déjà en place. La variable `SONAR_ENABLED=true` active le workflow.

### Supervision — `SENTRY_DSN`

1. [sentry.io](https://sentry.io) > **Projects** > **Create Project** > plateforme **Node.js**.
2. **Settings** > **Client Keys (DSN)** > copier le DSN.

- **Où** : `.env` et hébergeur.
- **Nécessaire** : à la mise en production.
- Le DSN n'est pas réellement secret (il est exposé côté client dans les apps front), mais on le traite comme tel par défaut.

---

## Révoquer un secret compromis

Un secret ayant transité par un canal non sécurisé, ou commité par erreur, doit être régénéré :

| Service | Où révoquer |
|---|---|
| SonarCloud | My Account > Security > **Revoke** |
| Cloudflare R2 | R2 > Manage API tokens > **Delete** |
| Upstash | Base > REST API > **Reset token** |
| Brevo | SMTP & API > **Delete** la clé SMTP |
| NotchPay | Settings > API Keys > **Roll** |
| JWT | Générer de nouvelles valeurs (déconnecte tous les utilisateurs) |

Puis mettre à jour `.env`, les secrets GitHub et les variables de l'hébergeur.

⚠️ Un secret commité reste dans l'historique git même après suppression du fichier : **le révoquer est obligatoire**, le retirer du code ne suffit pas.
