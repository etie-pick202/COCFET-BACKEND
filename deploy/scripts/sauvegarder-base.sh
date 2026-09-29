#!/usr/bin/env bash
# Sauvegarde la base d'un environnement.
#
#   sauvegarder-base.sh <staging|production>
#
# Planifiée chaque nuit par preparer-vps.sh. La base vit sur le disque de la
# VPS, et plus aucun hébergeur ne la sauvegarde à notre place : une copie qui
# reste sur la même machine disparaît avec son disque. D'où la copie vers un
# bucket R2 dès que /opt/cocfet/sauvegarde.env existe.

set -euo pipefail

environnement=${1:?"Usage : $0 <staging|production>"}
dossier="${COCFET_RACINE:-/opt/cocfet}/$environnement"
destination="/var/backups/cocfet/$environnement"
retention=${RETENTION_JOURS:-14}

mkdir -p "$destination"
chmod 700 "$destination"

fichier="$destination/cocfet-$environnement-$(date -u +%Y%m%dT%H%M%SZ).dump"
partiel="$fichier.partiel"
trap 'rm -f "$partiel"' EXIT

# Format personnalisé : compressé, et restaurable table par table.
cd "$dossier"
docker compose exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' >"$partiel"

# Renommé seulement une fois complet : un fichier au nom définitif n'est
# jamais une sauvegarde tronquée.
mv "$partiel" "$fichier"
chmod 600 "$fichier"
echo "Sauvegarde locale : $fichier ($(du -h "$fichier" | cut -f1))"

find "$destination" -name '*.dump' -mtime +"$retention" -delete

configuration="${COCFET_RACINE:-/opt/cocfet}/sauvegarde.env"
if [[ -f $configuration ]]; then
  # shellcheck disable=SC1090
  set -a && . "$configuration" && set +a
  docker run --rm \
    -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_DEFAULT_REGION=auto \
    -v "$destination:/sauvegardes:ro" \
    amazon/aws-cli s3 cp "/sauvegardes/$(basename "$fichier")" \
    "s3://$SAUVEGARDE_BUCKET/$environnement/" \
    --endpoint-url "$SAUVEGARDE_ENDPOINT" --only-show-errors
  echo "Copie hors machine : s3://$SAUVEGARDE_BUCKET/$environnement/"
else
  echo "ATTENTION : $configuration absent, la sauvegarde ne quitte pas la VPS." >&2
fi
