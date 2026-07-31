#!/usr/bin/env bash
# Saisie interactive des identifiants de services externes.
#
# Les valeurs sont lues sans être affichées à l'écran, écrites dans .env
# (ignoré par git) et, si demandé, poussées dans les secrets GitHub Actions.
# Rien n'est journalisé ni transmis ailleurs.
#
# Usage : ./scripts/setup-secrets.sh [--github]
#   --github  pousse également les valeurs dans les secrets du dépôt (gh requis)

set -euo pipefail

ENV_FILE=".env"
PUSH_GITHUB=false
REPO="etie-pick202/COCFET-BACKEND"

[ "${1:-}" = "--github" ] && PUSH_GITHUB=true

if [ ! -f "$ENV_FILE" ]; then
  cp .env.example "$ENV_FILE"
  echo "→ .env créé depuis .env.example"
fi

# Remplace une clé dans .env sans jamais afficher la valeur.
set_env() {
  local key="$1" value="$2"
  [ -z "$value" ] && return 0
  if grep -q "^${key}=" "$ENV_FILE"; then
    # Délimiteur | : les URL contiennent des /
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
  echo "  ✓ $key"
}

# Lecture masquée (secrets) ou visible (URL, identifiants non sensibles).
ask() {
  local key="$1" prompt="$2" masked="${3:-true}" value=""
  if [ "$masked" = "true" ]; then
    read -r -s -p "  $prompt : " value; echo
  else
    read -r -p "  $prompt : " value
  fi
  set_env "$key" "$value"
  if [ "$PUSH_GITHUB" = true ] && [ -n "$value" ]; then
    printf '%s' "$value" | gh secret set "$key" --repo "$REPO" >/dev/null
    echo "  ✓ $key poussé dans les secrets GitHub"
  fi
}

echo
echo "Laisser vide pour ignorer une valeur."
echo

echo "── Upstash Redis (limitation de débit) ──"
echo "  Console Upstash > votre base > onglet REST API"
ask UPSTASH_REDIS_REST_URL   "UPSTASH_REDIS_REST_URL" false
ask UPSTASH_REDIS_REST_TOKEN "UPSTASH_REDIS_REST_TOKEN"
echo

echo "── Cloudflare R2 (stockage fichiers) ──"
echo "  Cloudflare > R2 > Manage API tokens > Create API token (Object Read & Write)"
ask R2_ENDPOINT          "R2_ENDPOINT (https://<account-id>.r2.cloudflarestorage.com)" false
ask R2_BUCKET            "R2_BUCKET" false
ask R2_ACCESS_KEY_ID     "R2_ACCESS_KEY_ID"
ask R2_SECRET_ACCESS_KEY "R2_SECRET_ACCESS_KEY"
echo

echo "── SMTP (Brevo — staging et production uniquement) ──"
echo "  En développement local, Mailpit ne demande aucun identifiant :"
echo "  lancez « docker compose up -d » et laissez ces champs vides."
echo "  Brevo : app.brevo.com > SMTP & API > onglet SMTP"
ask MAIL_HOST     "MAIL_HOST" false
ask MAIL_PORT     "MAIL_PORT" false
ask MAIL_USER     "MAIL_USER" false
ask MAIL_PASSWORD "MAIL_PASSWORD"
echo

echo "Terminé. .env est ignoré par git : vérifiez avec « git status »."
[ "$PUSH_GITHUB" = false ] && echo "Pour pousser aussi vers GitHub Actions : ./scripts/setup-secrets.sh --github"
