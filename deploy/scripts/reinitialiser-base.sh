#!/usr/bin/env bash
# Vide la base d'un environnement et la ramène à un schéma neuf.
#
#   reinitialiser-base.sh <staging|production>
#
# À jouer une seule fois, entre la phase de tests et l'ouverture au public :
# une fois de vrais comptes et de vrais paiements en base, on ne vide plus.
#
# Ce script ne vit volontairement pas dans l'image de l'API. Un outil qui
# efface la base, embarqué dans le conteneur de production, serait à une
# commande de l'accident ; ici il faut un accès à la VPS, un terminal, et
# retaper le nom de l'environnement.
#
# Déroulé : sauvegarde (obligatoire), confirmation, arrêt de l'API, suppression
# du schéma, migrations, redémarrage. Le premier administrateur est à recréer
# ensuite (voir la fin de la sortie).
#
# Ce que le script ne nettoie PAS :
#   - le bucket R2 (photos, CV, logos, justificatifs) : à vider séparément ;
#   - les transactions Fapshi, qui restent dans le tableau de bord du prestataire.

set -euo pipefail

environnement=${1:?"Usage : $0 <staging|production>"}
racine="${COCFET_RACINE:-/opt/cocfet}"
dossier="$racine/$environnement"
scripts="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
sauvegardes="/var/backups/cocfet/$environnement"

case $environnement in
  staging | production) ;;
  *) echo "Environnement inconnu : $environnement (staging ou production)" >&2 && exit 1 ;;
esac

[[ -d $dossier ]] || { echo "Dossier introuvable : $dossier" >&2 && exit 1; }

# Une saisie au clavier n'est possible que dans un terminal : un appel depuis un
# cron ou un pipeline ne doit jamais pouvoir arriver jusqu'à la suppression.
[[ -t 0 ]] || { echo "Terminal interactif requis." >&2 && exit 1; }

cd "$dossier"

echo "⚠️  La base « $environnement » va être VIDÉE : comptes, commandes, billets,"
echo "    paiements, générations, tout. Aucun retour en arrière en dehors de la"
echo "    sauvegarde prise à l'instant."
read -r -p "Retapez « $environnement » pour continuer : " confirmation
[[ $confirmation == "$environnement" ]] || { echo "Abandon." && exit 1; }

if [[ $environnement == production ]]; then
  read -r -p "Production : retapez « JE VIDE LA PRODUCTION » pour confirmer : " phrase
  [[ $phrase == "JE VIDE LA PRODUCTION" ]] || { echo "Abandon." && exit 1; }
fi

echo "==> Sauvegarde préalable"
# set -e : si la sauvegarde échoue, on s'arrête ici, base intacte.
bash "$scripts/sauvegarder-base.sh" "$environnement"
derniere=$(find "$sauvegardes" -maxdepth 1 -name '*.dump' -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)
[[ -n $derniere && -s $derniere ]] || { echo "Aucune sauvegarde exploitable : abandon." >&2 && exit 1; }
echo "    Pour revenir en arrière : restaurer-base.sh $environnement $derniere"

echo "==> Arrêt de l'API"
docker compose stop backend

echo "==> Suppression du schéma"
# L'API se connecte avec le compte du conteneur Postgres : recréer le schéma
# sous ce compte lui en rend la propriété, sans autre droit à accorder.
docker compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -c "DROP SCHEMA public CASCADE" -c "CREATE SCHEMA public"'

echo "==> Migrations"
# En production, l'API ne rejoue pas les migrations à son démarrage
# (migrationsRun est faux) : c'est ce service qui recrée le schéma.
docker compose run --rm migrations

echo "==> Redémarrage de l'API"
docker compose up -d --no-deps backend

echo
echo "Base « $environnement » réinitialisée. Reste à faire :"
echo "  1. recréer le premier administrateur :"
echo "       docker compose run --rm cli node dist/seed/creer-admin.js --email … --prenom … --nom …"
echo "  2. vider le bucket R2 de l'environnement (fichiers orphelins) ;"
echo "  3. recréer la génération active, le bureau, les produits et les événements."
