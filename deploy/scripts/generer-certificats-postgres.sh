#!/usr/bin/env bash
# Génère l'autorité et le certificat TLS de la base d'un environnement.
#
#   generer-certificats-postgres.sh /opt/cocfet/production
#
# L'API refuse de se connecter à la base sans TLS en production, et vérifie le
# certificat présenté : sans autorité connue, elle le rejetterait. Chaque
# environnement reçoit sa propre autorité, pour qu'un certificat de recette ne
# soit jamais accepté par la production.
#
# Idempotent : ne régénère rien si les certificats existent déjà. Les
# remplacer imposerait de redémarrer base et API ensemble.

set -euo pipefail

dossier=${1:?"Usage : $0 <dossier de l'environnement>"}
certs="$dossier/certs"

if [[ -f "$certs/server.crt" ]]; then
  echo "Certificats déjà présents dans $certs : rien à faire."
  exit 0
fi

mkdir -p "$certs"
cd "$certs"
umask 077

# Autorité de l'environnement. Sa clé ne sert qu'à signer le certificat du
# serveur : elle reste ici, lisible par root seul.
openssl req -new -x509 -days 3650 -nodes \
  -subj "/CN=cocfet-postgres-$(basename "$dossier")" \
  -keyout ca.key -out ca.crt 2>/dev/null

# Certificat du serveur. Le nom « postgres » est celui sous lequel l'API joint
# la base sur le réseau interne : c'est lui que la vérification compare.
openssl req -new -nodes -subj "/CN=postgres" \
  -keyout server.key -out server.csr 2>/dev/null
printf 'subjectAltName=DNS:postgres\n' >server.ext
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 3650 -extfile server.ext -out server.crt 2>/dev/null
rm -f server.csr server.ext ca.srl

# PostgreSQL refuse de démarrer si sa clé est lisible par d'autres que lui.
# 999 est l'utilisateur postgres de l'image officielle Debian.
chown 999:999 server.key server.crt
chmod 600 server.key
# L'API tourne sous l'utilisateur node : elle doit pouvoir lire l'autorité.
chmod 644 ca.crt server.crt

echo "Certificats créés dans $certs (valables 10 ans)."
