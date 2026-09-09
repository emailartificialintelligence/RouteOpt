#!/usr/bin/env bash
#
# Deploy the OR-Tools sidecar to Google Cloud Run.
#
#   ./sidecar/deploy-cloud-run.sh my-project-id
#
# Everything below is chosen to stay inside the free allowance:
#
#   --min-instances 0   sleeps when nobody is planning, so idle costs nothing.
#                       Waking costs 2-4s, which the app tolerates.
#   --cpu 1 --memory 512Mi
#                       OR-Tools imports in under half a second and this problem
#                       size is small. Bigger costs more per second for no gain.
#   --concurrency 2     a solve pins a core; more concurrent requests on one
#                       instance make each slower rather than serving more.
#   --no-allow-unauthenticated is NOT used, because Vercel cannot present a
#                       Google identity token. The service is public at the
#                       network level and protected by ORTOOLS_TOKEN instead.

set -euo pipefail

PROJECT="${1:-}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-routeplan-solver}"

if [[ -z "$PROJECT" ]]; then
  echo "usage: $0 <google-cloud-project-id>" >&2
  echo "example: $0 routeplan-12345" >&2
  exit 1
fi

if ! command -v gcloud >/dev/null; then
  echo "gcloud is not installed. See: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

# A shared secret, so the endpoint is not free CPU for the whole internet.
TOKEN="${ORTOOLS_TOKEN:-$(openssl rand -hex 32)}"

echo "==> project $PROJECT, region $REGION, service $SERVICE"

gcloud config set project "$PROJECT" >/dev/null
gcloud services enable run.googleapis.com cloudbuild.googleapis.com --quiet

echo "==> building and deploying (first run takes a few minutes)"
gcloud run deploy "$SERVICE" \
  --source sidecar \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 3 \
  --cpu 1 \
  --memory 512Mi \
  --concurrency 2 \
  --timeout 60s \
  --set-env-vars "ORTOOLS_HOST=0.0.0.0,ORTOOLS_TOKEN=$TOKEN,ORTOOLS_MAX_BUDGET_MS=5000" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)')"

echo
echo "==> deployed"
echo
echo "    Add these two to Vercel (Settings -> Environment Variables),"
echo "    then redeploy the Vercel project so it picks them up:"
echo
echo "        ORTOOLS_URL=$URL"
echo "        ORTOOLS_TOKEN=$TOKEN"
echo
echo "    Check it is alive:"
echo "        curl $URL/health"
echo
