#!/usr/bin/env bash
# Prépare une VPS neuve (Ubuntu 24.04) pour héberger la recette et la
# production de COCFET.
#
#   sudo ./deploy/scripts/preparer-vps.sh "ssh-ed25519 AAAA… deploiement-cocfet"
#
# L'argument est la clé PUBLIQUE avec laquelle GitHub Actions se connectera
# pour déployer. À lancer depuis une copie du dépôt sur la VPS.
#
# Rejouable sans risque : rien d'existant n'est écrasé — ni les secrets, ni
# les mots de passe de base, ni les certificats. Voir docs/VPS.md.

set -euo pipefail

cle_deploiement=${1:?"Usage : $0 \"<clé publique SSH du déploiement>\""}
source_deploy=$(cd "$(dirname "$0")/.." && pwd)
racine=/opt/cocfet
utilisateur=deploy

[[ $EUID -eq 0 ]] || { echo "À lancer en root (sudo)." >&2 && exit 1; }

echo "==> Paquets système et mises à jour de sécurité automatiques"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq ca-certificates curl openssl ufw unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
# Sans plafond, les journaux des conteneurs finissent par remplir le disque —
# et une base qui ne peut plus écrire s'arrête.
if [[ ! -f /etc/docker/daemon.json ]]; then
  cat >/etc/docker/daemon.json <<'JSON'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  systemctl restart docker
fi

echo "==> Utilisateur de déploiement « $utilisateur »"
id "$utilisateur" >/dev/null 2>&1 || useradd -m -s /bin/bash "$utilisateur"
usermod -aG docker "$utilisateur"
install -d -m 700 -o "$utilisateur" -g "$utilisateur" "/home/$utilisateur/.ssh"
cles="/home/$utilisateur/.ssh/authorized_keys"
touch "$cles"
grep -qxF "$cle_deploiement" "$cles" || echo "$cle_deploiement" >>"$cles"
chown "$utilisateur:$utilisateur" "$cles"
chmod 600 "$cles"

echo "==> Mémoire d'appoint"
# Deux environnements complets tiennent dans 4 Go, mais sans marge : un pic
# ferait tuer un conteneur par le noyau plutôt que de ralentir.
if [[ -z $(swapon --show) ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

echo "==> Pare-feu : SSH, HTTP et HTTPS seulement"
# Docker contourne ufw pour les ports qu'il publie : seul Caddy en publie, et
# la base n'est publiée nulle part. C'est ce qui la garde injoignable.
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null

echo "==> Arborescence $racine"
install -d -o "$utilisateur" -g "$utilisateur" "$racine" "$racine/edge" "$racine/scripts"
install -m 755 -o "$utilisateur" -g "$utilisateur" "$source_deploy"/scripts/*.sh "$racine/scripts/"
install -m 644 -o "$utilisateur" -g "$utilisateur" \
  "$source_deploy/edge/Caddyfile" "$source_deploy/edge/docker-compose.yml" "$racine/edge/"
if [[ ! -f $racine/edge/.env ]]; then
  install -m 600 -o "$utilisateur" -g "$utilisateur" "$source_deploy/edge/.env.example" "$racine/edge/.env"
fi

for environnement in staging production; do
  dossier="$racine/$environnement"
  echo "==> Environnement $environnement"
  install -d -o "$utilisateur" -g "$utilisateur" "$dossier"
  install -m 644 -o "$utilisateur" -g "$utilisateur" \
    "$source_deploy/app/docker-compose.yml" "$dossier/"

  # Mot de passe généré une seule fois, jamais écrasé : le changer rendrait la
  # base existante inaccessible.
  if [[ ! -f $dossier/.env ]]; then
    sed -e "s|^ENVIRONNEMENT=.*|ENVIRONNEMENT=$environnement|" \
      -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 32)|" \
      "$source_deploy/app/.env.example" >"$dossier/.env"
  fi
  if [[ ! -f $dossier/backend.env ]]; then
    cp "$source_deploy/app/backend.env.example" "$dossier/backend.env"
  fi
  chown "$utilisateur:$utilisateur" "$dossier/.env" "$dossier/backend.env"
  chmod 600 "$dossier/.env" "$dossier/backend.env"

  "$racine/scripts/generer-certificats-postgres.sh" "$dossier"
done

echo "==> Sauvegardes nocturnes"
cat >/etc/cron.d/cocfet-sauvegardes <<CRON
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 2 * * * root $racine/scripts/sauvegarder-base.sh production >>/var/log/cocfet-sauvegardes.log 2>&1
0 3 * * * root $racine/scripts/sauvegarder-base.sh staging >>/var/log/cocfet-sauvegardes.log 2>&1
CRON
chmod 644 /etc/cron.d/cocfet-sauvegardes

cat <<SUITE

Préparation terminée. Reste à faire, dans cet ordre (détails : docs/VPS.md) :

  1. DNS : faire pointer les quatre domaines vers cette machine.
  2. Renseigner $racine/edge/.env, puis :
       cd $racine/edge && docker compose up -d
  3. Renseigner $racine/staging/backend.env et $racine/production/backend.env.
  4. Créer $racine/sauvegarde.env pour copier les sauvegardes hors machine.
  5. Déclarer les secrets GitHub (VPS_HOST, VPS_USER, VPS_SSH_KEY,
     VPS_KNOWN_HOSTS) puis la variable VPS_ENABLED=true.

Recommandé ensuite : désactiver la connexion SSH par mot de passe et celle de
root (PasswordAuthentication no, PermitRootLogin no), une fois vérifié que
votre propre clé fonctionne.
SUITE
