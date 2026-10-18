#!/usr/bin/env bash
# Deploy BatchGuard to Cloud Run (backend first, then frontend pointed at it).
#   ./deploy.sh            # both
#   ./deploy.sh backend    # one service
set -euo pipefail

PROJECT="${GCP_PROJECT:-$(cat backend/.gcp-project 2>/dev/null || gcloud config get-value project)}"
REGION="${GCP_REGION:-asia-southeast1}"
# Firebase web app (Google sign-in). Public client config, printed by: npx firebase-tools apps:sdkconfig web --project $PROJECT
FIREBASE_API_KEY="${FIREBASE_API_KEY:-AIzaSyAnB7-ZnFdm9dXA0Rj7FRZo1caExItxocc}"
FIREBASE_AUTH_DOMAIN="${FIREBASE_AUTH_DOMAIN:-batchguard-ai-33e4.firebaseapp.com}"
FIREBASE_APP_ID="${FIREBASE_APP_ID:-1:159884179678:web:6d8470b523cae698f06a4f}"
# URLs the backend pings every 30 s so the dashboard and simulator instances stay warm (';'-separated: commas belong to gcloud).
# Cloud Scheduler jobs (keepalive-*) ping the same targets every minute from outside — see ./deploy.sh keepalive.
KEEPALIVE_URLS="${KEEPALIVE_URLS:-https://batchguard.web.app/login;https://batchguard-sim.web.app/;https://batchguard-frontend-6our3ivvha-as.a.run.app/login;https://batchguard-simulator-6our3ivvha-as.a.run.app/api/state}"
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
    --service-account "$SA" --allow-unauthenticated --cpu 2 --memory 2Gi --min-instances 1 --max-instances 1 \
    --cpu-boost --no-cpu-throttling --timeout 3600 --concurrency 80 --port 8080 --session-affinity \
    --set-secrets "$SECRETS" \
    --set-env-vars "APP_URL=${APP_URL:-https://batchguard.web.app},KEEPALIVE_URLS=${KEEPALIVE_URLS},CORS_ORIGINS=${CORS_ORIGINS:-},GOOGLE_GENAI_USE_VERTEXAI=true,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=global,GCP_PROJECT=$PROJECT,GCP_LOCATION=$REGION,GCS_BUCKET=$PROJECT-manuals,BIGQUERY_DATASET=batchguard,PUBSUB_TOPIC_TELEMETRY=telemetry,CLOUD_LOGGING=true,DEMO_MODE=true,DEMO_PRODUCER=false,STALE_AFTER_SECONDS=30,FIREBASE_PROJECT_ID=$PROJECT,DOGRAH_BASE_URL=$DOGRAH_BASE_URL,DOGRAH_TELEPHONY_CONFIG_ID=$DOGRAH_TELEPHONY_CONFIG_ID,DOGRAH_FROM_PHONE_NUMBER_ID=$DOGRAH_FROM_PHONE_NUMBER_ID,VOICE_AUTO_DIAL=false,DB_SNAPSHOT=true,RESEND_FROM=$RESEND_FROM" \
    --quiet
  BACKEND_URL=$(gcloud run services describe batchguard-backend --region "$REGION" --format 'value(status.url)')
  echo "✓ backend: $BACKEND_URL"
}

deploy_frontend() {
  BACKEND_URL=$(gcloud run services describe batchguard-backend --region "$REGION" --format 'value(status.url)')
  echo "▶ building frontend image (BACKEND_URL=$BACKEND_URL)"
  # the public URL is only known after the first deploy; pass it in on re-deploys for correct code samples
  # public URL = Firebase Hosting site in front of Cloud Run (firebase.json); falls back to the Cloud Run URL
  APP_URL="${APP_URL:-https://batchguard.web.app}"
  gcloud builds submit . --config cloudbuild.frontend.yaml --substitutions "_IMAGE=$REPO/frontend:latest,_APP_URL=$APP_URL,_BACKEND_URL=$BACKEND_URL,_FIREBASE_API_KEY=$FIREBASE_API_KEY,_FIREBASE_AUTH_DOMAIN=$FIREBASE_AUTH_DOMAIN,_FIREBASE_PROJECT_ID=$PROJECT,_FIREBASE_APP_ID=$FIREBASE_APP_ID" --quiet
  echo "▶ deploying frontend (always-on instance, CPU never throttled: no cold starts)"
  gcloud run deploy batchguard-frontend --image "$REPO/frontend:latest" --region "$REGION" \
    --allow-unauthenticated --cpu 1 --memory 1Gi --min-instances 1 --max-instances 3 --port 8080 --no-cpu-throttling --cpu-boost \
    --set-env-vars "BACKEND_URL=$BACKEND_URL" --quiet
  FRONTEND_URL=$(gcloud run services describe batchguard-frontend --region "$REGION" --format 'value(status.url)')
  echo "✓ frontend: $FRONTEND_URL"
  echo "▶ telling the backend its public URL (for links in emails/calls + CORS)"
  gcloud run services update batchguard-backend --region "$REGION" --update-env-vars "APP_URL=$APP_URL,CORS_ORIGINS=$FRONTEND_URL" --quiet
  echo "▶ publishing the Firebase Hosting rewrite (firebase.json → Cloud Run)"
  GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-backend/secrets/sa.json}" npx -y firebase-tools@latest deploy --only hosting:app --project "$PROJECT" --non-interactive >/dev/null 2>&1 && echo "✓ hosting: $APP_URL" || echo "! hosting deploy skipped (run: npx firebase-tools deploy --only hosting)"
  echo "✓ done → $APP_URL (Cloud Run: $FRONTEND_URL)"
}

deploy_simulator() {
  BACKEND_URL=$(gcloud run services describe batchguard-backend --region "$REGION" --format 'value(status.url)')
  echo "▶ building simulator image"
  gcloud builds submit simulator --config simulator/cloudbuild.yaml --substitutions "_IMAGE=$REPO/simulator:latest,_DASHBOARD_URL=${APP_URL:-https://batchguard.web.app}" --quiet
  echo "▶ deploying simulator (always-on, single instance: it is the factory's telemetry source)"
  gcloud run deploy batchguard-simulator --image "$REPO/simulator:latest" --region "$REGION" \
    --allow-unauthenticated --cpu 1 --memory 512Mi --min-instances 1 --max-instances 1 --port 8080 --timeout 3600 --no-cpu-throttling --cpu-boost \
    --set-env-vars "BATCHGUARD_URL=$BACKEND_URL,DEMO_EMAIL=demo@batchguard.ai,DEMO_PASSWORD=demo1234,NEXT_PUBLIC_DASHBOARD_URL=${APP_URL:-https://batchguard.web.app}" --quiet
  SIM_URL=$(gcloud run services describe batchguard-simulator --region "$REGION" --format 'value(status.url)')
  echo "✓ simulator: $SIM_URL"
  echo "▶ publishing Firebase Hosting rewrite for the simulator site"
  GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-backend/secrets/sa.json}" npx -y firebase-tools@latest deploy --only hosting:sim --project "$PROJECT" --non-interactive >/dev/null 2>&1 && echo "✓ hosting: https://batchguard-sim.web.app" || echo "! hosting deploy skipped"
}

case "$WHAT" in
  backend) deploy_backend ;;
  frontend) deploy_frontend ;;
  simulator) deploy_simulator ;;
  all) deploy_backend; deploy_frontend; deploy_simulator ;;
  *) echo "usage: $0 [backend|frontend|simulator|all]"; exit 1 ;;
esac
