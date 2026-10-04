# Recette et production sur la VPS

| Environnement | Branche | Hébergement | Déploiement |
|---|---|---|---|
| Développement | `develop` | Railway | Par Railway, depuis `develop` |
| Recette | `staging` | VPS | `.github/workflows/deploiement.yml` |
| Production | `main` | VPS | `.github/workflows/deploiement.yml` |

La recette et la production partagent une seule machine, mais rien d'autre :
chacune a sa base, son réseau interne, ses secrets et ses plafonds mémoire. Une
fausse manœuvre en recette ne peut pas atteindre la base de production, qui
n'est même pas joignable depuis l'autre réseau.

## Architecture

```
                         Internet (80, 443)
                                │
                     ┌──────────▼──────────┐
                     │   Caddy (deploy/edge)│  certificats Let's Encrypt
                     └──┬───────┬───────┬──┬┘  automatiques
          réseau        │       │       │  │
          cocfet-edge   │       │       │  │
        ┌───────────────▼┐ ┌────▼─────┐ │  │
        │ production-    │ │production│ │  │   … même chose pour staging-backend
        │ backend        │ │-frontend │ │  │       et staging-frontend
        └───────┬────────┘ └──────────┘ │  │
   réseau       │ TLS vérifié           │  │
   interne      │                       │  │
        ┌───────▼────────┐              │  │
        │ postgres (prod)│  jamais publié, joignable par son seul backend
        └────────────────┘
```

- **Caddy** est le seul service exposé. Il route chaque domaine vers
  l'environnement correspondant et renouvelle seul les certificats.
- **PostgreSQL** tourne dans chaque environnement, sans port publié. L'API s'y
  connecte en TLS, avec vérification du certificat contre une autorité propre
  à l'environnement : l'application refuse de démarrer sans TLS en production,
  et c'est voulu.
- **Upstash** reste à l'extérieur pour la limitation de débit : il ne consomme
  rien sur la VPS, et une saturation de la machine n'emporte pas le seul
  garde-fou contre la force brute.
- **R2** garde les fichiers et, si configuré, une copie des sauvegardes.

La recette tourne elle aussi avec `NODE_ENV=production` : elle subit les mêmes
garde-fous que la production (R2 et Fapshi obligatoires, migrations explicites,
limitation de débit active). Une recette plus permissive laisserait passer ce
que la production refuserait.

## Dimensionnement

| | Minimum | Confortable |
|---|---|---|
| Mémoire | 4 Go | 8 Go |
| Processeurs | 2 vCPU | 4 vCPU |
| Disque | 40 Go SSD | 80 Go SSD |
| Système | Ubuntu 24.04 LTS | |

Chaque environnement plafonne base, API et frontend à 512 Mo chacun (réglable
dans `/opt/cocfet/<environnement>/.env`). Les images sont construites par
GitHub Actions, jamais sur la VPS : une compilation Next.js y consommerait
plus de mémoire que tout le reste réuni.

## Installation

Une seule fois, dans cet ordre.

### 1. Clé de déploiement

Sur votre poste :

```bash
ssh-keygen -t ed25519 -N "" -C deploiement-cocfet -f cocfet-deploiement
```

`cocfet-deploiement.pub` va sur la VPS (étape 2), `cocfet-deploiement` dans
les secrets GitHub (étape 6). Cette clé ne sert qu'au déploiement : ne pas la
réutiliser pour vos propres connexions.

### 2. Préparation de la machine

```bash
scp -r deploy root@<IP>:/root/cocfet-deploy
scp cocfet-deploiement.pub root@<IP>:/root/
ssh root@<IP>
bash /root/cocfet-deploy/scripts/preparer-vps.sh "$(cat /root/cocfet-deploiement.pub)"
```

Le script installe Docker, crée l'utilisateur `deploy`, ferme le pare-feu à
tout sauf SSH/HTTP/HTTPS, ajoute 2 Go de swap, prépare `/opt/cocfet`, génère
les mots de passe et certificats de chaque base, et planifie les sauvegardes.
Il peut être rejoué : rien d'existant n'est écrasé.

### 3. DNS

Quatre enregistrements `A` vers l'adresse de la VPS, **avant** l'étape 4 :
Let's Encrypt refuse de délivrer un certificat à un domaine qui ne pointe pas
vers la machine qui le demande.

| Domaine | Sert |
|---|---|
| `cocfet.example` | frontend de production |
| `api.cocfet.example` | API de production |
| `staging.cocfet.example` | frontend de recette |
| `api.staging.cocfet.example` | API de recette |

### 4. Proxy

```bash
sudo -u deploy nano /opt/cocfet/edge/.env      # domaines et e-mail ACME
cd /opt/cocfet/edge && sudo -u deploy docker compose up -d
```

### 5. Secrets de l'API

```bash
sudo -u deploy nano /opt/cocfet/staging/backend.env
sudo -u deploy nano /opt/cocfet/production/backend.env
```

Modèle commenté : `deploy/app/backend.env.example`. Points d'attention :

- `CORS_ORIGIN` : le frontend **du même environnement**.
- Une paire JWT, un bucket R2 et un jeton R2 **distincts** par environnement.
- Fapshi : bac à sable en recette (l'API l'annonce par un avertissement au
  démarrage, c'est attendu), service live en production.
- `SWAGGER_ENABLED=true` en recette seulement.

### 6. GitHub

Dans **chacun des deux dépôts** (API et frontend), `Settings → Secrets and
variables → Actions` :

| Secret | Valeur |
|---|---|
| `VPS_HOST` | adresse IP ou nom de la VPS |
| `VPS_USER` | `deploy` |
| `VPS_SSH_KEY` | contenu de `cocfet-deploiement` (clé **privée**) |
| `VPS_KNOWN_HOSTS` | sortie de `ssh-keyscan -t ed25519 <IP>` |

Vérifier l'empreinte de `VPS_KNOWN_HOSTS` contre celle affichée sur la VPS
elle-même (`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`) : c'est elle qui
empêche une machine usurpée de recevoir la clé de déploiement.

Puis la variable `VPS_ENABLED=true`. Tant qu'elle n'existe pas, les workflows
de déploiement sont ignorés au lieu d'échouer.

Côté frontend, ajouter aussi dans les environnements GitHub `staging` et
`production` la variable `API_URL` (`https://api.staging.cocfet.example`,
`https://api.cocfet.example`) : Next.js l'inscrit dans le code au moment de
la construction, d'où une image par environnement.

Recommandé : dans l'environnement `production`, activer **Required reviewers**
pour qu'une mise en production attende une validation humaine.

### 7. Sauvegardes hors machine

Créer un bucket R2 dédié (`cocfet-sauvegardes`) et un jeton restreint à lui,
puis :

```bash
sudo tee /opt/cocfet/sauvegarde.env >/dev/null <<'ENV'
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
SAUVEGARDE_BUCKET=cocfet-sauvegardes
SAUVEGARDE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
ENV
sudo chmod 600 /opt/cocfet/sauvegarde.env
```

Sans ce fichier, les sauvegardes restent sur le disque de la VPS — et
disparaîtraient avec lui. Le journal le signale à chaque nuit.

### 8. Premier déploiement

Pousser sur `staging`, puis sur `main`, ou lancer le workflow à la main
(`Actions → Déploiement VPS → Run workflow`). Le frontend se déploie depuis son
propre dépôt.

## Déployer

Un push sur `staging` ou `main` suffit. Le workflow construit l'image,
l'envoie sur la VPS et lance `deploy/scripts/deployer.sh`, qui :

1. joue les **migrations** — un échec arrête tout, la version en service n'est
   pas touchée ;
2. démarre la nouvelle version ;
3. attend la **sonde de santé** — si elle ne répond pas, **remet en service la
   version précédente** et fait échouer le workflow.

Le retour arrière porte sur le code, pas sur le schéma : une migration
appliquée le reste. Les migrations doivent donc ajouter sans retirer ce dont la
version précédente a besoin.

La définition Compose et les scripts voyagent avec chaque déploiement de
l'API : une modification de l'infrastructure passe par PR comme le reste.

## Exploiter

```bash
cd /opt/cocfet/production          # ou staging

docker compose ps                   # état et santé
docker compose logs -f backend      # journaux de l'API
docker compose restart backend      # redémarrage

# Revenir à une version précédente encore présente sur la machine
docker image ls cocfet-backend-production
bash /opt/cocfet/scripts/deployer.sh production backend <tag>
```

### Sauvegardes

Planifiées chaque nuit (production 2 h 30, recette 3 h UTC), conservées 14
jours sur la VPS, journal dans `/var/log/cocfet-sauvegardes.log`.

```bash
sudo bash /opt/cocfet/scripts/sauvegarder-base.sh production
sudo bash /opt/cocfet/scripts/restaurer-base.sh staging /var/backups/cocfet/production/<fichier>.dump
```

Restaurer de temps en temps une sauvegarde de production **dans la recette** :
une sauvegarde jamais restaurée n'est qu'une supposition.

### Repartir d'une base vide

Entre la phase de tests et l'ouverture au public :

```bash
sudo bash /opt/cocfet/scripts/reinitialiser-base.sh production
```

Le script prend une sauvegarde (il s'arrête si elle échoue), demande de retaper
le nom de l'environnement — et, en production, une phrase de confirmation —,
arrête l'API, recrée le schéma, rejoue les migrations et relance l'API. Il
exige un terminal interactif et n'est pas dans l'image de l'API : à une
commande de l'accident, un outil d'effacement n'a rien à faire dans le
conteneur de production.

Il ne nettoie pas tout :

- **Le bucket R2** (photos, CV, logos, justificatifs) : les fichiers de test
  restent, orphelins. À vider séparément.
- **Fapshi** : les transactions réelles restent dans le tableau de bord du
  prestataire, ni supprimables ni remboursables automatiquement. Tester avec de
  petits montants.
- **À recréer ensuite** : le premier administrateur (section suivante), la
  génération active, le bureau, les produits et les événements.

À ne faire qu'**avant** de vrais comptes et de vrais paiements : ensuite, on ne
vide plus, on supprime au cas par cas.

### Premier administrateur

Une seule commande, **identique en recette et en production**, qui demande le
mot de passe au clavier :

```bash
cd /opt/cocfet/production          # ou staging
docker compose run --rm cli node dist/seed/creer-admin.js \
  --email <adresse> --prenom <prénom> --nom <nom>
```

Elle réclame le mot de passe deux fois, **sans l'afficher**, puis écrit
`Administrateur créé : <adresse> (ADMIN).`

- **Le mot de passe n'est ni en argument, ni dans la configuration, ni dans un
  fichier** : un argument finirait dans l'historique du shell et la liste des
  processus. Sans terminal interactif (tube, redirection), l'outil refuse.
- **Même règle que l'inscription** : 12 caractères au moins, des lettres et au
  moins un chiffre ou un symbole. Une phrase de passe longue convient.
- **Il ne sert qu'une fois.** Dès qu'un administrateur existe, il refuse :
  les suivants se nomment depuis l'application, où chaque ajout laisse une
  trace.
- **`--role`** vaut `ADMIN` par défaut, le rôle du bureau, que la passation
  rétrograde à chaque changement de mandat. `SUPER_ADMIN` est le rôle
  d'exploitation, que la passation n'atteint jamais et qu'aucun parcours de
  l'application ne donne : seul cet outil ou un accès à la base le crée.
  Le choisir pour le compte de la personne qui exploite la plateforme.

Ensuite, tout se fait par l'application : la génération, les postes du bureau,
ses membres.

Le seed `pnpm run seed` reste réservé au développement : il refuse de
s'exécuter en production, parce qu'il lit le mot de passe dans la
configuration.
