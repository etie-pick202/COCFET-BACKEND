#!/usr/bin/env bash
# Restaure une sauvegarde dans la base d'un environnement.
#
#   restaurer-base.sh <staging|production> <fichier.dump>
#
# Remplace le contenu actuel de la base. L'API est arrêtée pendant
# l'opération : restaurer sous ses pieds mêlerait des écritures en cours à des
# tables à moitié rechargées.
#
# Une sauvegarde jamais restaurée n'est qu'une supposition : essayer ce script
# en recette de temps en temps, sur une sauvegarde de production, est le seul
# moyen de savoir qu'il fonctionnera le jour où il faudra.

set -euo pipefail

environnement=${1:?"Usage : $0 <staging|production> <fichier.dump>"}
fichier=${2:?"Usage : $0 <staging|production> <fichier.dump>"}
dossier="${COCFET_RACINE:-/opt/cocfet}/$environnement"

[[ -f $fichier ]] || { echo "Fichier introuvable : $fichier" >&2 && exit 1; }

echo "Le contenu actuel de la base « $environnement » va être REMPLACÉ par :"
echo "  $fichier"
read -r -p "Retapez « $environnement » pour confirmer : " confirmation
[[ $confirmation == "$environnement" ]] || { echo "Abandon." && exit 1; }

cd "$dossier"
docker compose stop backend

docker compose exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' \
  <"$fichier"

docker compose start backend
echo "Restauration terminée. Vérifier : docker compose ps"
