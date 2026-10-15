# BatchGuard backend — FastAPI + Google ADK on Cloud Run
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /srv

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts

# Cloud Run: the attached service account provides credentials (no key file);
# data lives in /data (ephemeral unless a volume is mounted) and mirrors to Firestore/BigQuery.
ENV DATABASE_PATH=/data/batchguard.db UPLOAD_DIR=/data/uploads PORT=8080
RUN mkdir -p /data/uploads

EXPOSE 8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
