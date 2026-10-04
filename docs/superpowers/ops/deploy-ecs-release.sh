#!/bin/bash
# Switch an ECS environment to the images of one release. Run from a terminal on the Mac that has
# ~/.aws set up and Docker running. It uses the official amazon/aws-cli image, so the AWS CLI itself
# does not have to be installed.
#
#   ENV=prod TAG=prod-39414bf  bash deploy-ecs-release.sh            # asks you to type DEPLOY first
#   ENV=prod TAG=prod-39414bf  DRY_RUN=1 bash deploy-ecs-release.sh  # read-only: shows what it would do
#   ENV=test TAG=test-39414bf  bash deploy-ecs-release.sh
#
# What it does, in order (backend first, the frontend only if the backend rollout completed):
#   1. checks that both images exist in ECR with that tag;
#   2. copies the service's current task definition, changes ONLY the container image, registers it
#      as a new revision, and updates the service to it;
#   3. waits until the rollout is COMPLETED or FAILED. The services have a deployment circuit breaker
#      with automatic rollback, so a version that crashes on start is rolled back by ECS itself;
#   4. prints the exact command that returns each service to its previous revision.
# It never prints environment values or secrets, and it deletes its temporary files when it ends.

set -euo pipefail

ENV_NAME="${ENV:-prod}"
TAG="${TAG:?set TAG, for example TAG=prod-39414bf}"
REGION="${REGION:-ap-south-1}"
ACCOUNT="${ACCOUNT:-609665073007}"
REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
CLUSTER="stratschool-$ENV_NAME-cluster"
DRY_RUN="${DRY_RUN:-0}"

if [ "$ENV_NAME" = "prod" ]; then
  BACKEND_SVC="prod-nebulaa-gravity-backend-service"; FRONTEND_SVC="prod-nebulaa-gravity-frontend-svc"
else
  BACKEND_SVC="test-nebulaa-gravity-backend-svc"; FRONTEND_SVC="test-nebulaa-gravity-frontend-svc"
fi

WORK="$(mktemp -d)"; chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

aws() { docker run --rm -v "$HOME/.aws:/root/.aws:ro" -v "$WORK:/work" amazon/aws-cli --region "$REGION" --output json "$@"; }

echo "Environment: $ENV_NAME   cluster: $CLUSTER   image tag: $TAG   dry run: $DRY_RUN"

# 1. the images must exist
for REPO in "$ENV_NAME/nebulaa_gravity_backend" "$ENV_NAME/nebulaa_gravity_frontend"; do
  if aws ecr describe-images --repository-name "$REPO" --image-ids imageTag="$TAG" --query 'imageDetails[0].imageDigest' >/dev/null 2>&1; then
    echo "  image present: $REPO:$TAG"
  else
    echo "  MISSING image: $REPO:$TAG  -> push the images first, then run this again"; exit 1
  fi
done

if [ "$DRY_RUN" != "1" ]; then
  echo
  read -r -p "This changes the LIVE $ENV_NAME services. Type DEPLOY to continue: " ANSWER
  [ "$ANSWER" = "DEPLOY" ] || { echo "Cancelled. Nothing was changed."; exit 1; }
fi

deploy_service() {  # $1 service name, $2 ECR repo name
  local SVC="$1" REPO="$2" NEW_IMAGE="$REGISTRY/$2:$TAG"
  echo; echo "=== $SVC"
  local OLD_TD; OLD_TD="$(aws ecs describe-services --cluster "$CLUSTER" --services "$SVC" --query 'services[0].taskDefinition' | tr -d '"\n')"
  echo "  current task definition: ${OLD_TD##*/}"
  aws ecs describe-task-definition --task-definition "$OLD_TD" --query 'taskDefinition' > "$WORK/td-old.json"
  python3 - "$WORK/td-old.json" "$WORK/td-new.json" "$NEW_IMAGE" <<'PY'
import json, sys
src, dst, image = sys.argv[1:4]
td = json.load(open(src))
keep = ["family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions", "volumes",
        "placementConstraints", "requiresCompatibilities", "cpu", "memory", "runtimePlatform",
        "ephemeralStorage", "pidMode", "ipcMode", "proxyConfiguration", "inferenceAccelerators"]
new = {k: td[k] for k in keep if k in td and td[k] not in (None, [], {})}
old_image = new["containerDefinitions"][0]["image"]
new["containerDefinitions"][0]["image"] = image
json.dump(new, open(dst, "w"))
print("  image: %s\n      -> %s" % (old_image, image))
PY
  if [ "$DRY_RUN" = "1" ]; then echo "  (dry run: nothing registered, nothing updated)"; return 0; fi
  local NEW_TD; NEW_TD="$(aws ecs register-task-definition --cli-input-json file:///work/td-new.json --query 'taskDefinition.taskDefinitionArn' | tr -d '"\n')"
  echo "  registered: ${NEW_TD##*/}"
  aws ecs update-service --cluster "$CLUSTER" --service "$SVC" --task-definition "$NEW_TD" --query 'service.serviceName' >/dev/null
  echo "  service updated; waiting for the rollout (up to 15 minutes)..."
  local STATE="" I
  for I in $(seq 1 45); do
    sleep 20
    STATE="$(aws ecs describe-services --cluster "$CLUSTER" --services "$SVC" --query 'services[0].deployments[?status==`PRIMARY`].rolloutState | [0]' | tr -d '"\n')"
    echo "    $(date +%H:%M:%S)  rollout: $STATE"
    [ "$STATE" = "COMPLETED" ] || [ "$STATE" = "FAILED" ] && break
  done
  echo "  last service events:"; aws ecs describe-services --cluster "$CLUSTER" --services "$SVC" --query 'services[0].events[0:4].message' | sed 's/^/    /'
  echo "  TO GO BACK to the previous revision, run:"
  echo "    docker run --rm -v \$HOME/.aws:/root/.aws:ro amazon/aws-cli --region $REGION ecs update-service --cluster $CLUSTER --service $SVC --task-definition $OLD_TD"
  [ "$STATE" = "COMPLETED" ] || { echo "  ROLLOUT DID NOT COMPLETE (state: ${STATE:-unknown}). ECS rolls back by itself when its circuit breaker trips; check the events above."; return 1; }
}

deploy_service "$BACKEND_SVC" "$ENV_NAME/nebulaa_gravity_backend"
deploy_service "$FRONTEND_SVC" "$ENV_NAME/nebulaa_gravity_frontend"
echo; echo "Done. Open the site and check it loads, then tell the assistant the result."
