#!/usr/bin/env bash
# Met en service une nouvelle version de l'API ou du frontend.
#
#   deployer.sh <staging|production> <backend|frontend> <tag>
#
# L'image cocfet-<service>-<environnement>:<tag> doit déjà être chargée sur la
# machine (le workflow de déploiement l'y transfère par « docker load »).
#
# Pour l'API, les migrations sont jouées d'abord : un échec arrête tout avant
# que la version en service ne soit touchée. Ensuite, si la nouvelle version
# ne répond pas à sa sonde de santé, la précédente est remise en service.
#
# Le retour arrière porte sur le code, pas sur le schéma : une migration déjà
# appliquée reste appliquée. D'où l'importance de migrations qui n'ajoutent
# sans rien retirer de ce dont l'ancienne version a besoin.

set -euo pipefail

environnement=${1:?"Usage : $0 <staging|production> <backend|frontend> <tag>"}
service=${2:?"Usage : $0 <staging|production> <backend|frontend> <tag>"}
tag=${3:?"Usage : $0 <staging|production> <backend|frontend> <tag>"}

case "$environnement" in
  staging | production) ;;
  *) echo "Environnement inconnu : $environnement" >&2 && exit 2 ;;
esac

case "$service" in
  backend) variable=BACKEND_TAG ;;
  frontend) variable=FRONTEND_TAG ;;
  *) echo "Service inconnu : $service" >&2 && exit 2 ;;
esac

dossier="${COCFET_RACINE:-/opt/cocfet}/$environnement"
depot="cocfet-$service-$environnement"
cd "$dossier"

if ! docker image inspect "$depot:$tag" >/dev/null 2>&1; then
  echo "Image $depot:$tag absente : elle doit être chargée avant le déploiement." >&2
  exit 1
fi

grep -q "^$variable=" .env || echo "$variable=aucun" >>.env
precedent=$(grep "^$variable=" .env | cut -d= -f2-)

ecrire_tag() {
  local valeur=$1
  sed -i "s|^$variable=.*|$variable=$valeur|" .env
}

attendre_sante() {
  local conteneur etat
  conteneur=$(docker compose ps -q "$service")
  for _ in $(seq 1 36); do
    etat=$(docker inspect -f '{{.State.Health.Status}}' "$conteneur" 2>/dev/null || echo absent)
    [[ $etat == healthy ]] && return 0
    [[ $etat == unhealthy ]] && return 1
    sleep 5
  done
  return 1
}

echo "==> $environnement / $service : $precedent -> $tag"
ecrire_tag "$tag"

if [[ $service == backend ]]; then
  docker compose up -d postgres
  echo "==> Migrations"
  if ! docker compose run --rm migrations; then
    echo "Échec des migrations : la version $precedent reste en service." >&2
    ecrire_tag "$precedent"
    exit 1
  fi
fi

docker compose up -d --no-deps "$service"

if attendre_sante; then
  echo "==> $service $tag en service."
else
  echo "La version $tag ne répond pas à la sonde de santé." >&2
  docker compose logs --tail 50 "$service" >&2 || true
  if [[ $precedent != aucun ]]; then
    echo "==> Retour à $precedent" >&2
    ecrire_tag "$precedent"
    docker compose up -d --no-deps "$service"
  fi
  exit 1
fi

# Ne garde que la version en service et la précédente, pour qu'un retour
# arrière manuel reste possible sans remplir le disque d'images.
docker image ls "$depot" --format '{{.Tag}}' |
  grep -vx -e "$tag" -e "$precedent" |
  xargs -r -I{} docker image rm "$depot:{}" >/dev/null || true
docker image prune -f >/dev/null
