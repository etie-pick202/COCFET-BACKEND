#!/usr/bin/env bash
# Applique les règles de protection de branches sur le dépôt GitHub COCFET-BACKEND.
# Prérequis : gh CLI authentifié avec le scope "repo" (gh auth status).
# Usage : ./scripts/setup-branch-protection.sh <owner>/<repo>

set -euo pipefail

REPO="${1:?Usage: setup-branch-protection.sh <owner>/<repo>}"

protect() {
  local branch="$1"
  local required_reviews="$2"
  echo "Protecting $branch on $REPO (reviews required: $required_reviews)..."
  gh api \
    --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/$REPO/branches/$branch/protection" \
    -f "required_status_checks[strict]=true" \
    -f "required_status_checks[contexts][]=Lint" \
    -f "required_status_checks[contexts][]=Type check" \
    -f "required_status_checks[contexts][]=Unit & integration tests" \
    -f "required_status_checks[contexts][]=Build" \
    -F "enforce_admins=true" \
    -F "required_pull_request_reviews[required_approving_review_count]=$required_reviews" \
    -F "required_pull_request_reviews[dismiss_stale_reviews]=true" \
    -F "required_conversation_resolution=true" \
    -F "restrictions=null" \
    -F "allow_force_pushes=false" \
    -F "allow_deletions=false"
}

protect "main" 2
protect "staging" 1
protect "develop" 1

echo "Done. Verify at: https://github.com/$REPO/settings/branches"
