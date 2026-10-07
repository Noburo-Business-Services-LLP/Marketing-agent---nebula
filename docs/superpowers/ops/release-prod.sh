#!/bin/bash
# One command to ship the current commit to an ECS environment: build both images for amd64,
# push them to ECR, then switch the services with deploy-ecs-release.sh. Run it from a terminal on
# the Mac that has Docker running and ~/.aws set up.
#
#   bash docs/superpowers/ops/release-prod.sh                # production, tag prod-<git short sha>
#   ENV=test bash docs/superpowers/ops/release-prod.sh       # test environment, tag test-<sha>
#   DRY_RUN=1 bash docs/superpowers/ops/release-prod.sh      # builds and checks, pushes nothing, changes nothing
#   NO_CACHE=1 bash docs/superpowers/ops/release-prod.sh     # rebuild from scratch (use after a disk-full or a corrupted build cache)
#
# Safety: it refuses to run with uncommitted changes (so the image matches a commit), prints what it
# will do, and asks you to type DEPLOY before it pushes or changes anything (not in a dry run).
# The services roll out one task at a time with automatic rollback; the deploy script prints the
# exact command that returns each service to its previous revision.

set -euo pipefail

cd "$(dirname "$0")/../../.."
ENV_NAME="${ENV:-prod}"
REGION="${REGION:-ap-south-1}"
ACCOUNT="${ACCOUNT:-609665073007}"
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
DRY_RUN="${DRY_RUN:-0}"
CACHE_FLAG=""; [ "${NO_CACHE:-0}" = "1" ] && CACHE_FLAG="--no-cache"

if [ -n "$(git status --porcelain)" ]; then
  echo "There are uncommitted changes. Commit or stash them first, so the image matches a commit."; git status --short | head -10; exit 1
fi
SHA="$(git rev-parse --short HEAD)"
TAG="$ENV_NAME-$SHA"
# However this run ends, tidy Docker afterwards (keeps the images just built, so a retry stays fast).
trap 'KEEP_TAG="$TAG" bash "$(dirname "$0")/docker-cleanup.sh" || true' EXIT
BACKEND_IMAGE="$REGISTRY/$ENV_NAME/nebulaa_gravity_backend:$TAG"
FRONTEND_IMAGE="$REGISTRY/$ENV_NAME/nebulaa_gravity_frontend:$TAG"

echo "Environment: $ENV_NAME   commit: $SHA ($(git log -1 --format=%s | cut -c1-70))   tag: $TAG   dry run: $DRY_RUN"
echo "Backend image : $BACKEND_IMAGE"
echo "Frontend image: $FRONTEND_IMAGE"
docker info >/dev/null 2>&1 || { echo "Docker is not running. Open Docker Desktop and try again."; exit 1; }

# Builds need several GB of working space; running out corrupts the build cache (it happened once).
MIN_FREE_GB="${MIN_FREE_GB:-6}"
FREE_GB="$(df -g / | awk 'NR==2 {print $4}')"
if [ "$FREE_GB" -lt "$MIN_FREE_GB" ]; then
  echo "Only $FREE_GB GB free on this Mac. Cleaning up Docker leftovers first..."
  bash "$(dirname "$0")/docker-cleanup.sh"
  FREE_GB="$(df -g / | awk 'NR==2 {print $4}')"
  if [ "$FREE_GB" -lt "$MIN_FREE_GB" ]; then
    echo "Still only $FREE_GB GB free. Free up at least $MIN_FREE_GB GB (Trash, Downloads, old files) and run this again. Nothing was built."; exit 1
  fi
fi

echo; echo "== Building the backend image (linux/amd64)"
docker buildx build $CACHE_FLAG --platform linux/amd64 --load -f Dockerfile.backend -t "$BACKEND_IMAGE" .
echo; echo "== Building the frontend image (linux/amd64)"
docker buildx build $CACHE_FLAG --platform linux/amd64 --load -f Dockerfile.frontend -t "$FRONTEND_IMAGE" .

echo; echo "== Smoke test of the backend image (no network): native libraries and the new modules must load"
docker run --rm --network none --platform linux/amd64 -e NODE_ENV=production "$BACKEND_IMAGE" node -e "
const c=require('canvas'); if(!c.createCanvas(10,10).getContext('2d')) throw new Error('canvas');
if(!require('fs').existsSync(require('ffmpeg-static'))) throw new Error('ffmpeg missing');
require('./services/heroVideoFinish'); require('./services/blueprint/service'); require('./routes/blueprint'); require('./config/entitlements');
console.log('backend image smoke test: ok');"

if [ "$DRY_RUN" = "1" ]; then
  echo; echo "Dry run: images built and checked, nothing pushed, nothing deployed."; exit 0
fi

echo
read -r -p "This pushes the images and changes the LIVE $ENV_NAME services. Type DEPLOY to continue: " ANSWER
[ "$ANSWER" = "DEPLOY" ] || { echo "Cancelled. Nothing was pushed or changed."; exit 1; }

echo; echo "== Pushing to ECR (Docker signs in with the saved AWS keys through the ecr-login helper)"
docker push "$BACKEND_IMAGE"
docker push "$FRONTEND_IMAGE"

echo; echo "== Switching the services (you will be asked to type DEPLOY once more by the deploy script)"
ENV="$ENV_NAME" TAG="$TAG" bash docs/superpowers/ops/deploy-ecs-release.sh

echo; echo "Released $TAG. Open the site, check it, and tell the assistant what you see."
