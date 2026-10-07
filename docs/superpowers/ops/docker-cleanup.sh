#!/bin/bash
# Frees the disk space Docker builds leave behind. Safe: it removes only
#   1. old LOCAL copies of our own release images (ECR keeps every release, so rollback is not affected),
#   2. untagged leftover images, and
#   3. build cache older than one day.
# It never touches your code, your data, or any container that is running.
#
#   bash docs/superpowers/ops/docker-cleanup.sh                    # clean up
#   DRY_RUN=1 bash docs/superpowers/ops/docker-cleanup.sh          # only show what would be removed
#   KEEP_TAG=prod-abc1234 bash docs/superpowers/ops/docker-cleanup.sh   # also keep this release's images

set -uo pipefail

ACCOUNT="${ACCOUNT:-609665073007}"
REGION="${REGION:-ap-south-1}"
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
DRY_RUN="${DRY_RUN:-0}"
KEEP_TAG="${KEEP_TAG:-}"

docker info >/dev/null 2>&1 || { echo "Docker is not running, nothing to clean."; exit 0; }

free_gb() { df -g / | awk 'NR==2 {print $4}'; }
echo "== Docker cleanup. Free disk space before: $(free_gb) GB"

for ENV_NAME in prod test; do
  for APP in nebulaa_gravity_backend nebulaa_gravity_frontend; do
    REPO="$REGISTRY/$ENV_NAME/$APP"
    docker images "$REPO" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | while read -r IMAGE; do
      [ -z "$IMAGE" ] && continue
      if [ -n "$KEEP_TAG" ] && [ "${IMAGE##*:}" = "$KEEP_TAG" ]; then echo "  keeping $IMAGE"; continue; fi
      if [ "$DRY_RUN" = "1" ]; then echo "  would remove $IMAGE"; else echo "  removing $IMAGE"; docker rmi "$IMAGE" >/dev/null 2>&1 || echo "    (in use, left in place)"; fi
    done
  done
done

if [ "$DRY_RUN" = "1" ]; then
  echo "  would remove untagged images and build cache older than 24h"
  docker system df
else
  docker image prune -f >/dev/null 2>&1
  docker builder prune -f --filter "until=24h" >/dev/null 2>&1
fi

echo "== Done. Free disk space after: $(free_gb) GB"
exit 0
