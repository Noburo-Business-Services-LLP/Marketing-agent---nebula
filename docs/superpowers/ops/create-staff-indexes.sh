#!/bin/bash
# Builds the extra database indexes the staff Usage page needs (list: backend/config/staffIndexes.js).
# Run it yourself on your Mac (Docker running, ~/.aws set up, Node installed). The database address is read from the
# production secret and handed to the script; it is never printed.
#
#   bash docs/superpowers/ops/create-staff-indexes.sh                                  # DRY RUN: shows what it would do, changes nothing
#   CONFIRM_CREATE_INDEXES=yes bash docs/superpowers/ops/create-staff-indexes.sh       # builds the missing indexes, one at a time
#
# For the Home page indexes use the same command with INDEX_SCRIPT=create-home-indexes.js in front.
# Safe to run twice: indexes that exist are skipped. See docs/superpowers/ops/staff-pages-performance.md.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../../.." && pwd)"
aws() { docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN -e AWS_DEFAULT_REGION -v "$HOME/.aws:/root/.aws:ro" amazon/aws-cli "$@"; }
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-south-1}"
SECRET_ID="${SECRET_ID:-nebulaa-gravity/prod/backend}"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
SECRET="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text)"
cd "$HERE/backend"
MONGODB_URI="$(SECRET="$SECRET" python3 -c 'import json,os; print(json.loads(os.environ["SECRET"]).get("MONGODB_URI",""))')" \
  exec node "scripts/${INDEX_SCRIPT:-create-staff-indexes.js}" "$@"
