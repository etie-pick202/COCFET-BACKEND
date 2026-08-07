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

**Vérification du certificat TLS.** Elle est active par défaut. Si l'hébergeur présente un certificat signé par une autorité privée, fournir cette autorité via `DATABASE_SSL_CA` plutôt que de désactiver la vérification.

`DATABASE_SSL_REJECT_UNAUTHORIZED=false` est un dernier recours : la connexion accepte alors **n'importe quel certificat**, y compris celui d'un attaquant interposé. Sur une base portant des données personnelles d'étudiants et des transactions, c'est une exposition réelle. À ne jamais laisser en production sans avoir épuisé l'option `DATABASE_SSL_CA`.

### Authentification — `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`

Ces valeurs ne s'obtiennent nulle part : **on les génère soi-même**, une paire distincte par environnement.

```bash
openssl rand -base64 48
```

- **Où** : `.env` en local ; secrets GitHub Actions pour la CI ; variables d'environnement de l'hébergeur en production.
- **Nécessaire** : immédiatement.
- ⚠️ Changer ces secrets invalide tous les tokens en circulation et déconnecte tous les utilisateurs.

**L'application refuse de démarrer** si l'un des trois cas suivants se présente :

| Cas | Pourquoi c'est bloquant |
|---|---|
| Secret de moins de 32 caractères | HS256 signe avec le secret tel quel. Une phrase courte se retrouve **hors ligne**, sans une seule requête vers l'API, à partir d'un jeton intercepté — et forger un jeton d'administrateur ne demande alors rien de plus. |
| Valeur reprise de `.env.example` | Elle figure dans un dépôt public. |
| Les deux secrets identiques | Un refresh token deviendrait une signature valide pour le garde d'accès : il ouvrirait l'API **sept jours** au lieu de quinze minutes, alors que c'est justement le jeton conservé côté client. |

Deux contrôles supplémentaires ne s'appliquent qu'en production : `DATABASE_SSL` doit valoir `true`, et `DATABASE_SYNCHRONIZE` ne peut pas valoir `true`.

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

### Paiement — `FAPSHI_API_USER`, `FAPSHI_API_KEY`, `FAPSHI_WEBHOOK_SECRET`

1. [dashboard.fapshi.com](https://dashboard.fapshi.com) > créer un **service de collecte** (`Collection`). Un service de décaissement ne sert pas à encaisser : Fapshi impose deux services distincts si les deux usages sont nécessaires.
2. Relever `apiuser` et `apikey`. **Chaque environnement a les siens** : le bac à sable et la production sont deux services séparés, avec deux paires d'identifiants.
3. Dans les réglages du service, poser un **secret de webhook** et déclarer l'URL `https://<domaine>/api/v1/webhooks/fapshi`.

- **Où** : `.env` en local (identifiants du bac à sable), environnements GitHub pour `staging` et `production`.
- **Nécessaire** : laisser les variables vides bascule sur la passerelle factice ; les renseigner suffit à passer au prestataire réel, sans toucher au code.
- ⚠️ **Le secret de webhook n'est pas relisible** une fois posé — le tableau de bord ne l'affiche jamais, ni ne dit s'il en existe un. Notez-le au moment où vous le créez.

| Environnement | URL de base |
|---|---|
| Développement | `https://sandbox.fapshi.com` |
| Staging, production | `https://live.fapshi.com` |

**Une URL publique est nécessaire pour le webhook.** Le serveur de Fapshi doit joindre le nôtre : `localhost` ne convient pas. Pour essayer avant le déploiement, un tunnel (`ngrok http 3000`) fournit une URL temporaire à déclarer dans le service.

#### Pourquoi l'authentification du webhook ne suffit pas

Fapshi **ne signe pas** ses notifications. Là où d'autres prestataires calculent un HMAC du corps, Fapshi renvoie un secret statique dans l'en-tête `x-wh-secret`, à comparer au nôtre.

La différence n'est pas cosmétique. Un HMAC prouve que *ce corps précis* vient du prestataire ; un secret partagé prouve seulement que l'appelant le connaît. Qui récupère ce secret — un journal, une capture d'écran, une variable d'environnement exposée — peut forger une notification « paiement réussi » et se faire délivrer un billet jamais payé.

C'est pourquoi l'adaptateur **ne croit pas le corps reçu** : il y lit uniquement le `transId`, puis redemande l'état à Fapshi par `GET /payment-status/:transId`. Le statut retenu vient de cette réponse-là. Une notification forgée ne survit pas à cette seconde question.

Le coût est d'un appel HTTP supplémentaire par paiement. Le bénéfice est qu'un secret qui fuite ne permet plus de fabriquer des billets — il permet seulement de nous faire interroger Fapshi pour rien.

#### Le whitelisting d'IP, et pourquoi il n'est pas activé

Fapshi permet de déclarer une liste d'adresses IP autorisées à **créer** des transactions (paiements, liens de paiement, décaissements). Une fois la liste non vide, une requête venant d'une IP absente reçoit un **403, même avec des identifiants parfaitement valides**. C'est une seconde barrière : des identifiants volés ne servent à rien depuis une machine inconnue.

**Nous ne l'activons pas pour l'instant**, et c'est un choix, pas un oubli :

- L'hébergeur n'est pas encore arrêté, et les plateformes visées (Railway, Render) ne garantissent pas d'adresse de sortie fixe sur leurs offres courantes. Une IP qui change au redéploiement transformerait la liste blanche en panne de paiement, sans message clair pour l'utilisateur.
- La documentation de Fapshi recommande elle-même de ne rien déclarer lorsque l'IP du serveur varie.
- La protection reste assurée par les identifiants, distincts par environnement, et par la revérification systématique du statut décrite plus haut.

**À reconsidérer** dès que la production tournera sur une IP de sortie stable — une passerelle NAT, un service avec IP dédiée. Ce jour-là, déclarer l'IP de production coûte quelques minutes et ferme une porte de plus.

En attendant, un symptôme à connaître : un **403** de Fapshi signifie soit des identifiants invalides, soit une IP non autorisée. L'adaptateur journalise explicitement les deux hypothèses, faute de pouvoir les distinguer.

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

## État de configuration

Deux environnements GitHub existent : `staging` (alimenté par la branche `staging`) et `production` (branche `main`). Les valeurs y sont cloisonnées — un secret de staging n'est jamais lisible depuis un déploiement de production, ni l'inverse.

| Variable | staging | production | Type |
|---|:---:|:---:|---|
| `MAIL_USER`, `MAIL_PASSWORD` | ✅ | ✅ | secret |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_FROM` | ✅ | ✅ | variable |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | ✅ | ✅ | secret |
| `R2_BUCKET` | ✅ | ✅ | variable |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ✅ | ✅ | secret |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | ✅ | ✅ | secret |
| `DATABASE_URL` | ❌ | ❌ | secret |
| `FAPSHI_API_USER`, `FAPSHI_API_KEY`, `FAPSHI_WEBHOOK_SECRET` | ❌ | ❌ | secret |

Chaque environnement possède ses propres identifiants Brevo et son propre jeton R2, restreint à son seul bucket (`cocfet-staging`, `cocfet-prod`). Une fuite côté staging ne donne donc aucun accès aux fichiers de production.

### Ce qui reste

**`DATABASE_URL`** — dépend de l'hébergeur, qui n'est pas encore choisi. C'est le seul secret manquant qui empêche un déploiement.

> Sous Windows, `openssl` n'est pas disponible. Pour générer un secret sans qu'il s'affiche ni n'entre dans l'historique du shell :
>
> ```bash
> node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64'))" | gh secret set JWT_ACCESS_SECRET --env staging --repo etie-pick202/COCFET-BACKEND
> ```

**`FAPSHI_*`** — le compte est ouvert et le service créé. Restent à poser : les identifiants du bac à sable en local, ceux du service live dans les environnements `staging` et `production`, et le secret de webhook côté tableau de bord.

**Domaine d'envoi** — le COCFET n'a pas encore de nom de domaine. L'expéditeur validé est une adresse Gmail individuelle : suffisant pour tester, insuffisant en production. Sans SPF ni DKIM publiés sur un domaine propre, les messages de vérification partent en spam chez Gmail et Outlook — et sans message de vérification, aucun compte ne peut être créé.

---

## Révoquer un secret compromis

Un secret ayant transité par un canal non sécurisé, ou commité par erreur, doit être régénéré :

| Service | Où révoquer |
|---|---|
| SonarCloud | My Account > Security > **Revoke** |
| Cloudflare R2 | R2 > Manage API tokens > **Delete** |
| Upstash | Base > REST API > **Reset token** |
| Brevo | SMTP & API > **Delete** la clé SMTP |
| Fapshi | Tableau de bord > service > régénérer la paire `apiuser`/`apikey` |
| JWT | Générer de nouvelles valeurs (déconnecte tous les utilisateurs) |

Puis mettre à jour `.env`, les secrets GitHub et les variables de l'hébergeur.

⚠️ Un secret commité reste dans l'historique git même après suppression du fichier : **le révoquer est obligatoire**, le retirer du code ne suffit pas.
