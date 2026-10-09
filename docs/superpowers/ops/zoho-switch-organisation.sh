#!/bin/bash
# Points the production backend at a different Zoho Books organisation, with a new login token.
# Run it yourself on your Mac (Docker running, ~/.aws set up). It changes ONLY these four values in the
# production secret nebulaa-gravity/prod/backend: ZOHO_BOOKS_ORG_ID, ZOHO_BOOKS_CLIENT_ID,
# ZOHO_BOOKS_CLIENT_SECRET and ZOHO_BOOKS_REFRESH_TOKEN. Nothing is printed except counts, and AWS keeps the
# previous version of the secret (label AWSPREVIOUS), so it can be undone.
#
# Before you run it, in the Zoho account that OWNS the organisation (the one that sees your real invoices):
#   1. Open https://api-console.zoho.in  ->  Add Client  ->  Self Client  (note the Client ID and Client Secret).
#   2. Generate Code, with this scope (one line, no spaces) and 10 minutes validity:
#        ZohoBooks.invoices.CREATE,ZohoBooks.invoices.READ,ZohoBooks.invoices.UPDATE,ZohoBooks.contacts.CREATE,ZohoBooks.contacts.READ,ZohoBooks.customerpayments.CREATE,ZohoBooks.customerpayments.READ,ZohoBooks.settings.READ
#      (create, read and update only: the app can never delete anything in Zoho Books)
#      Scope description: Nebulaa billing. Pick the organisation from the list if it asks.
#   3. Copy the code, run this script, and paste the values when asked (secret and code are hidden).
set -euo pipefail

aws() { docker run --rm -i -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN -e AWS_DEFAULT_REGION -v "$HOME/.aws:/root/.aws:ro" amazon/aws-cli "$@"; }
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-south-1}"
SECRET_ID="${SECRET_ID:-nebulaa-gravity/prod/backend}"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true

read -r -p "Zoho Books organisation ID (for example 60071831783): " ORG
read -r -p "Self Client ID: " CID
read -r -s -p "Self Client secret (hidden): " CSEC; echo
read -r -s -p "Grant code (hidden): " CODE; echo

echo "== Exchanging the code for a refresh token"
TOKEN_JSON="$(curl -s -X POST https://accounts.zoho.in/oauth/v2/token -d grant_type=authorization_code -d client_id="$CID" -d client_secret="$CSEC" -d code="$CODE")"
REFRESH="$(printf '%s' "$TOKEN_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.refresh_token||'')}catch(e){}})")"
ACCESS="$(printf '%s' "$TOKEN_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.access_token||'')}catch(e){}})")"
if [ -z "$REFRESH" ] || [ -z "$ACCESS" ]; then
  echo "Zoho did not give a token. Reason: $(printf '%s' "$TOKEN_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).error||'unknown')}catch(e){console.log('unreadable answer')}})")"
  echo "The code works once and only for 10 minutes. Generate a fresh code and try again. Nothing was changed."; exit 1
fi

echo "== Checking that this login can see organisation $ORG (read-only)"
CHECK="$(curl -s -H "Authorization: Zoho-oauthtoken $ACCESS" "https://www.zohoapis.in/books/v3/invoices?organization_id=$ORG&per_page=200")"
printf '%s' "$CHECK" | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{let j;try{j=JSON.parse(s)}catch(e){console.log('Could not read the answer.');process.exit(1)}
if(j.code!==0){console.log('Zoho refused: '+j.message);console.log('This login is not a member of that organisation, or the scope is missing. Nothing was changed.');process.exit(1)}
const n=(j.invoices||[]).length;console.log('OK: the organisation has '+n+(j.page_context&&j.page_context.has_more_page?'+':'')+' invoices on the first page.');
console.log('Newest: '+(j.invoices||[]).slice(0,5).map(i=>i.invoice_number).join(', '))})" || exit 1

echo
read -r -p "Update the production secret with these four values? Type UPDATE to continue: " OK
[ "$OK" = "UPDATE" ] || { echo "Cancelled. Nothing was changed."; exit 0; }

CURRENT="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text)"
NEW="$(printf '%s' "$CURRENT" | ORG="$ORG" CID="$CID" CSEC="$CSEC" REFRESH="$REFRESH" node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);
j.ZOHO_BOOKS_ORG_ID=process.env.ORG;j.ZOHO_BOOKS_CLIENT_ID=process.env.CID;j.ZOHO_BOOKS_CLIENT_SECRET=process.env.CSEC;j.ZOHO_BOOKS_REFRESH_TOKEN=process.env.REFRESH;
process.stdout.write(JSON.stringify(j))})")"
printf '%s' "$NEW" | aws secretsmanager put-secret-value --secret-id "$SECRET_ID" --secret-string file:///dev/stdin >/dev/null
echo "Done: the production secret now holds the new Zoho Books values (the old version is kept as AWSPREVIOUS)."
echo
read -r -p "Restart the production backend now so it picks them up? Type RESTART to do it: " R
if [ "$R" = "RESTART" ]; then
  aws ecs update-service --cluster stratschool-prod-cluster --service prod-nebulaa-gravity-backend-service --force-new-deployment --query 'service.deployments[0].rolloutState' --output text
  echo "The backend is restarting (about 2 minutes). Tell the assistant when it is up."
else
  echo "Not restarted. The new values take effect the next time the backend restarts or is released."
fi
