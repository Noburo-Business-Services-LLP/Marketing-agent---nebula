#!/bin/bash
# Read-only. Shows which settings exist in the production secret (nebulaa-gravity/prod/backend) and which of the
# ones the app needs are missing. It prints only NAMES and "set" or "missing". It never prints a value.
# Run it yourself on your Mac (Docker running, ~/.aws set up):  bash docs/superpowers/ops/check-secret-keys.sh
set -euo pipefail

aws() { docker run --rm -i -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN -e AWS_DEFAULT_REGION -v "$HOME/.aws:/root/.aws:ro" amazon/aws-cli "$@"; }
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-south-1}"
SECRET_ID="${SECRET_ID:-nebulaa-gravity/prod/backend}"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true

# Needed by the current build. REQUIRED: the feature fails without it. OPTIONAL: a feature is limited without it.
REQUIRED="MONGODB_URI JWT_SECRET HASH_PEPPER OPENAI_API_KEY GEMINI_API_KEY FAL_KEY RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY CLOUDINARY_API_SECRET"
OPTIONAL="ENABLE_PHOTOSHOOT ENABLE_COMPETITOR_DRAFTS ENABLE_COMPETITOR_THUMBS ENABLE_STUDIO_VIDEO_CONSUMER ENABLE_PHOTOSHOOT_CONSUMER RATE_LIMIT_STORE TRUST_PROXY_HOPS BCRYPT_ROUNDS ENABLE_COMPETITOR_TRACKER ENABLE_LISTENING LISTENING_MODEL APIFY_API_KEY SERPER_API_KEY AYRSHARE_API_KEY ELEVENLABS_API_KEY RESEND_API_KEY CLAUDE_API_KEY ALERT_EMAILS PROOFREAD_MODEL TEXT_MODEL_ENGLISH TEXT_MODEL_REGIONAL IMAGE_QUALITY_START OMNI_MODEL RAZORPAY_PLAN_ID_AGENCY RAZORPAY_PLAN_ID_SLOT"

aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text \
 | SECRET_ID_LABEL="$SECRET_ID" REQUIRED="$REQUIRED" OPTIONAL="$OPTIONAL" node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const j=JSON.parse(s); const has=(k)=>typeof j[k]==='string'&&j[k].trim().length>0;
  const show=(label,list)=>{ console.log('\n'+label); for(const k of list.split(' ')) console.log('  '+(has(k)?'set      ':'MISSING  ')+k); };
  console.log('Secret: '+process.env.SECRET_ID_LABEL+'  ('+Object.keys(j).length+' settings)');
  show('Needed (the app fails without these):',process.env.REQUIRED);
  show('Optional (a feature is limited without these):',process.env.OPTIONAL);
  for(const k of ['JWT_SECRET','HASH_PEPPER']) console.log('  length of '+k+': '+(has(k)?j[k].length:0)+'  (needs at least 32 in production)');
  const known=new Set((process.env.REQUIRED+' '+process.env.OPTIONAL).split(' '));
  const others=Object.keys(j).filter(k=>!known.has(k)).sort();
  console.log('\nOther names in the secret ('+others.length+'): '+others.join(', '));
});" 
