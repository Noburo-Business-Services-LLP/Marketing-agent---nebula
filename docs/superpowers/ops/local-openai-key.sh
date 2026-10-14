#!/bin/bash
# Copies ONLY the OpenAI key from the production secret into backend/.env (local testing). Run it yourself on your
# Mac (Docker running, ~/.aws set up). The key is never printed. Only the OPENAI_API_KEY line of backend/.env changes.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../../.." && pwd)"
ENVF="$HERE/backend/.env"
[ -f "$ENVF" ] || { echo "backend/.env not found. Run docs/superpowers/ops/local-env.sh first."; exit 1; }
aws() { docker run --rm -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN -e AWS_DEFAULT_REGION=ap-south-1 -v "$HOME/.aws:/root/.aws:ro" amazon/aws-cli "$@"; }
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-south-1}"
SECRET="$(aws secretsmanager get-secret-value --secret-id nebulaa-gravity/prod/backend --query SecretString --output text)"
ENVF="$ENVF" SECRET="$SECRET" python3 - <<'PY'
import json, os
key = json.loads(os.environ['SECRET']).get('OPENAI_API_KEY', '')
if not key: raise SystemExit('No OPENAI_API_KEY in the production secret. Nothing changed.')
p = os.environ['ENVF']
lines = [l for l in open(p).read().splitlines() if not l.startswith('OPENAI_API_KEY=')]
lines.append('OPENAI_API_KEY=' + key)
open(p, 'w').write('\n'.join(lines) + '\n')
print('OPENAI_API_KEY in backend/.env now comes from the production secret (value not shown).')
PY
