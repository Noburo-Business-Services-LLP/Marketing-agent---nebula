#!/bin/bash
# Builds backend/.env for LOCAL real testing from your existing local .env, keeping ONLY what image and text
# generation need. Everything that could reach real customers or money is left out on purpose: payments, email,
# social posting, Zoho, the production database. Refuses to run unless the database in the source file is the
# development one (nebulaa_dev). Never prints a value.
set -euo pipefail
SRC="${1:-$HOME/Documents/0 CONTENT/Claude Agents/Marketing-agent---nebula/backend/.env}"
HERE="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="$HERE/backend/.env"
[ -f "$SRC" ] || { echo "Source env file not found: $SRC"; exit 1; }
python3 - "$SRC" "$OUT" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
env = {}
for line in open(src):
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, v = line.split('=', 1); env[k.strip()] = v.strip()
uri = env.get('MONGODB_URI', '')
m = re.search(r'/([^/?]+)(\?|$)', uri.split('@')[-1])
db = m.group(1) if m else ''
if db != 'nebulaa_dev':
    sys.exit(f"Refusing: MONGODB_URI points at database '{db}', not 'nebulaa_dev'.")
if uri == env.get('PROD_MONGODB_URI'):
    sys.exit("Refusing: MONGODB_URI equals PROD_MONGODB_URI.")
KEEP = ['MONGODB_URI', 'JWT_SECRET', 'JWT_EXPIRES_IN', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'GROQ_API_KEY', 'CLAUDE_API_KEY',
        'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'VERTEX_PROJECT_ID', 'VERTEX_LOCATION',
        'VERTEX_CLIENT_EMAIL', 'VERTEX_PRIVATE_KEY', 'FAL_KEY', 'ELEVENLABS_API_KEY', 'SERPER_API_KEY']
lines = [f"{k}={env[k]}" for k in KEEP if env.get(k)]
lines += ['PORT=5000', 'NODE_ENV=development', 'FRONTEND_URL=http://localhost:3000', 'ENABLE_BILLING_SCHEDULER=false', 'CORS_ALLOWED_ORIGINS=http://127.0.0.1:3000,http://localhost:3000']
open(out, 'w').write('\n'.join(lines) + '\n')
print('Wrote', out)
print('Kept:', ', '.join(k for k in KEEP if env.get(k)))
print('Left out (on purpose): payments, email, social posting, Zoho, production database.')
PY
