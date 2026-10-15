#!/bin/bash
# Sets ONE value in the production secret (nebulaa-gravity/prod/backend), for example RAZORPAY_WEBHOOK_SECRET or
# ALERT_EMAILS. Run it yourself on your Mac (Docker running, ~/.aws set up). The value is typed hidden and never
# printed; every other value in the secret is kept as it is, and AWS keeps the previous version (AWSPREVIOUS).
# Only these names are accepted, so a typing slip cannot create a stray setting.
set -euo pipefail

ALLOWED="RAZORPAY_WEBHOOK_SECRET ALERT_EMAILS APP_PUBLIC_URL SIGNUPS_PER_DAY SIGNUP_MODE SIGNUP_INVITE_CODES TURNSTILE_SITE_KEY TURNSTILE_SECRET_KEY GEMINI_API_KEY FAL_KEY APIFY_API_KEY SERPER_API_KEY CLAUDE_API_KEY"
aws() { docker run --rm -i -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN -e AWS_DEFAULT_REGION -v "$HOME/.aws:/root/.aws:ro" amazon/aws-cli "$@"; }
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-south-1}"
SECRET_ID="${SECRET_ID:-nebulaa-gravity/prod/backend}"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true

echo "Settings you can set here: $ALLOWED"
read -r -p "Name of the setting: " NAME
case " $ALLOWED " in *" $NAME "*) ;; *) echo "That name is not in the list. Nothing was changed."; exit 1;; esac
read -r -s -p "Value for $NAME (hidden): " VALUE; echo
[ -n "$VALUE" ] || { echo "The value is empty. Nothing was changed."; exit 1; }
if [ "$NAME" = "RAZORPAY_WEBHOOK_SECRET" ] && [ "${#VALUE}" -lt 24 ]; then echo "Use at least 24 characters (openssl rand -base64 36 makes a good one). Nothing was changed."; exit 1; fi

CURRENT="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text)"
HAD="$(printf '%s' "$CURRENT" | NAME="$NAME" node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j[process.env.NAME]?'already set (it will be replaced)':'not set yet')})")"
echo "$NAME is $HAD."
read -r -p "Type UPDATE to save it: " OK
[ "$OK" = "UPDATE" ] || { echo "Cancelled. Nothing was changed."; exit 0; }

NEW="$(printf '%s' "$CURRENT" | NAME="$NAME" VALUE="$VALUE" node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);j[process.env.NAME]=process.env.VALUE;process.stdout.write(JSON.stringify(j))})")"
printf '%s' "$NEW" | aws secretsmanager put-secret-value --secret-id "$SECRET_ID" --secret-string file:///dev/stdin >/dev/null
echo "Saved $NAME in the production secret."
read -r -p "Restart the production backend now so it picks it up? Type RESTART to do it, or press Enter to skip: " R
if [ "$R" = "RESTART" ]; then
  aws ecs update-service --cluster stratschool-prod-cluster --service prod-nebulaa-gravity-backend-service --force-new-deployment --query 'service.deployments[0].rolloutState' --output text
  echo "The backend is restarting (about 2 minutes)."
else
  echo "Not restarted. It takes effect at the next restart or release."
fi
