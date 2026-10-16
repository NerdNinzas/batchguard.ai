#!/usr/bin/env bash
# Deploy BatchGuard to Cloud Run (backend first, then frontend pointed at it).
#   ./deploy.sh            # both
#   ./deploy.sh backend    # one service
set -euo pipefail

PROJECT="${GCP_PROJECT:-$(cat backend/.gcp-project 2>/dev/null || gcloud config get-value project)}"
REGION="${GCP_REGION:-asia-southeast1}"
REPO="$REGION-docker.pkg.dev/$PROJECT/batchguard"
SA="batchguard-backend@$PROJECT.iam.gserviceaccount.com"
WHAT="${1:-all}"
# Voice AI (Dograh → TeleCMI). The API key lives in Secret Manager: 
#   printf '%s' "$DOGRAH_API_KEY" | gcloud secrets create batchguard-dograh-key --data-file=-
DOGRAH_BASE_URL="${DOGRAH_BASE_URL:-https://139-59-65-115.sslip.io/api/v1}"
DOGRAH_TELEPHONY_CONFIG_ID="${DOGRAH_TELEPHONY_CONFIG_ID:-2}"
DOGRAH_FROM_PHONE_NUMBER_ID="${DOGRAH_FROM_PHONE_NUMBER_ID:-3}"
# Email via Resend: create the secret once →  printf '%s' "$RESEND_API_KEY" | gcloud secrets create batchguard-resend-key --data-file=-
SECRETS="AUTH_SECRET=batchguard-auth-secret:latest,DOGRAH_API_KEY=batchguard-dograh-key:latest"
if gcloud secrets describe batchguard-resend-key --project "$PROJECT" >/dev/null 2>&1; then SECRETS="$SECRETS,RESEND_API_KEY=batchguard-resend-key:latest"; fi
RESEND_FROM="${RESEND_FROM:-BatchGuard AI <onboarding@resend.dev>}"

echo "▶ project=$PROJECT region=$REGION"
gcloud config set project "$PROJECT" >/dev/null

deploy_backend() {
  echo "▶ building backend image"
  gcloud builds submit backend --tag "$REPO/backend:latest" --quiet
  echo "▶ deploying backend (always-on, single instance: SQLite + demo producer + SSE)"
  gcloud run deploy batchguard-backend --image "$REPO/backend:latest" --region "$REGION" \
    --service-account "$SA" --allow-unauthenticated --cpu 1 --memory 1Gi --min-instances 1 --max-instances 1 \
    --cpu-boost --no-cpu-throttling --timeout 3600 --concurrency 80 --port 8080 \
    --set-secrets "$SECRETS" \
    --set-env-vars "GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=global,GCP_PROJECT=$PROJECT,GCP_LOCATION=$REGION,GCS_BUCKET=$PROJECT-manuals,BIGQUERY_DATASET=batchguard,PUBSUB_TOPIC_TELEMETRY=telemetry,CLOUD_LOGGING=true,DEMO_MODE=true,FIREBASE_PROJECT_ID=$PROJECT,DOGRAH_BASE_URL=$DOGRAH_BASE_URL,DOGRAH_TELEPHONY_CONFIG_ID=$DOGRAH_TELEPHONY_CONFIG_ID,DOGRAH_FROM_PHONE_NUMBER_ID=$DOGRAH_FROM_PHONE_NUMBER_ID,VOICE_AUTO_DIAL=false,RESEND_FROM=$RESEND_FROM" \
    --quiet
  BACKEND_URL=$(gcloud run services describe batchguard-backend --region "$REGION" --format 'value(status.url)')
  echo "✓ backend: $BACKEND_URL"
}

deploy_frontend() {
  BACKEND_URL=$(gcloud run services describe batchguard-backend --region "$REGION" --format 'value(status.url)')
  echo "▶ building frontend image (BACKEND_URL=$BACKEND_URL)"
  # the public URL is only known after the first deploy; pass it in on re-deploys for correct code samples
  APP_URL="${APP_URL:-$(gcloud run services describe batchguard-frontend --region "$REGION" --format 'value(status.url)' 2>/dev/null || echo https://batchguard.run.app)}"
  gcloud builds submit . --config cloudbuild.frontend.yaml --substitutions "_IMAGE=$REPO/frontend:latest,_APP_URL=$APP_URL,_BACKEND_URL=$BACKEND_URL" --quiet
  echo "▶ deploying frontend (scale-to-zero)"
  gcloud run deploy batchguard-frontend --image "$REPO/frontend:latest" --region "$REGION" \
    --allow-unauthenticated --cpu 1 --memory 512Mi --min-instances 0 --max-instances 3 --port 8080 \
    --set-env-vars "BACKEND_URL=$BACKEND_URL" --quiet
  FRONTEND_URL=$(gcloud run services describe batchguard-frontend --region "$REGION" --format 'value(status.url)')
  echo "✓ frontend: $FRONTEND_URL"
  echo "▶ telling the backend its public URL (for device code samples + CORS)"
  gcloud run services update batchguard-backend --region "$REGION" --update-env-vars "APP_URL=$FRONTEND_URL" --quiet
  echo "✓ done → $FRONTEND_URL"
}

case "$WHAT" in
  backend) deploy_backend ;;
  frontend) deploy_frontend ;;
  all) deploy_backend; deploy_frontend ;;
  *) echo "usage: $0 [backend|frontend|all]"; exit 1 ;;
esac
