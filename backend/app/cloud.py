"""Google Cloud adapters. Every call is optional, non-blocking and fails soft: SQLite stays the
fast local store; these mirror/stream to the cloud services when GCP_PROJECT is configured.

  Firestore      operational mirror: orgs, contacts, machines (+latest), incidents, notifications
  Pub/Sub        every ingested reading → topic `telemetry` → BigQuery subscription (no code)
  BigQuery       long-window history for the agent's get_readings (SQLite covers the last hours)
  Cloud Storage  uploaded manuals / datasheets
  Cloud Logging  structured logs
"""

import json
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any

from .config import settings

log = logging.getLogger("batchguard.cloud")
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="gcp")
_lock = threading.Lock()
_clients: dict[str, Any] = {}


def enabled() -> bool:
    return bool(settings.gcp_project)


def _client(kind: str) -> Any:
    with _lock:
        if kind in _clients:
            return _clients[kind]
        try:
            if kind == "firestore":
                from google.cloud import firestore

                c = firestore.Client(project=settings.gcp_project, database=settings.firestore_database or "(default)")
            elif kind == "pubsub":
                from google.cloud import pubsub_v1

                c = pubsub_v1.PublisherClient()
            elif kind == "bigquery":
                from google.cloud import bigquery

                c = bigquery.Client(project=settings.gcp_project)
            elif kind == "storage":
                from google.cloud import storage

                c = storage.Client(project=settings.gcp_project)
            else:
                raise ValueError(kind)
        except Exception as e:  # noqa: BLE001
            log.warning("gcp client %s unavailable: %s", kind, e)
            c = None
        _clients[kind] = c
        return c


def _bg(fn, *args) -> None:
    if not enabled():
        return
    _pool.submit(_safe, fn, *args)


def _safe(fn, *args) -> None:
    try:
        fn(*args)
    except Exception as e:  # noqa: BLE001
        log.warning("gcp %s failed: %s", getattr(fn, "__name__", fn), e)


def _clean(d: dict[str, Any]) -> dict[str, Any]:
    out = {}
    for k, v in d.items():
        if k in ("api_key_hash", "password_hash", "manual_text"):
            continue
        if isinstance(v, str) and v[:1] in "[{" and k in ("signals", "report", "feedback", "knowledge", "use_cases", "nodes", "edges", "tool_calls"):
            try:
                v = json.loads(v)
            except Exception:  # noqa: BLE001
                pass
        out[k] = v
    return out


# ---------- Firestore mirror ----------
def mirror(collection: str, doc_id: str, data: dict[str, Any], merge: bool = True) -> None:
    def run() -> None:
        db = _client("firestore")
        if db is None:
            return
        db.collection(collection).document(doc_id).set({**_clean(data), "_mirrored_at": datetime.now(timezone.utc)}, merge=merge)

    _bg(run)


def mirror_latest(machine_id: str, org_id: str, latest: dict[str, Any], status: str | None = None) -> None:
    def run() -> None:
        db = _client("firestore")
        if db is None:
            return
        doc: dict[str, Any] = {"org_id": org_id, "latest": latest, "_mirrored_at": datetime.now(timezone.utc)}
        if status:
            doc["status"] = status
        db.collection("machines").document(machine_id).set(doc, merge=True)

    _bg(run)


def delete(collection: str, doc_id: str) -> None:
    def run() -> None:
        db = _client("firestore")
        if db is not None:
            db.collection(collection).document(doc_id).delete()

    _bg(run)


# ---------- Pub/Sub → BigQuery ----------
def publish_readings(m: dict[str, Any], readings: list[dict[str, Any]], received_at: float) -> None:
    def run() -> None:
        pub = _client("pubsub")
        if pub is None or not settings.pubsub_topic_telemetry:
            return
        topic = pub.topic_path(settings.gcp_project, settings.pubsub_topic_telemetry)
        for r in readings:
            msg = {
                "org_id": m["org_id"], "machine_id": m["id"], "device_id": m["device_id"], "parameter": r["parameter"],
                "value": float(r["value"]), "unit": r.get("unit"), "state": r.get("state"),
                "ts": datetime.fromtimestamp(float(r.get("ts") or received_at), tz=timezone.utc).isoformat(),
                "received_at": datetime.fromtimestamp(received_at, tz=timezone.utc).isoformat(),
                "reading_id": r.get("reading_id"),
            }
            pub.publish(topic, json.dumps(msg).encode(), machine_id=m["id"], parameter=r["parameter"])

    _bg(run)


def query_history(machine_id: str, parameter: str, seconds: int, points: int = 300) -> list[dict[str, float]]:
    """Synchronous BigQuery read for long windows. Returns [] when disabled or on error."""
    if not enabled() or not settings.bigquery_dataset:
        return []
    bq = _client("bigquery")
    if bq is None:
        return []
    try:
        from google.cloud import bigquery

        sql = f"""
            SELECT UNIX_SECONDS(ts) AS t, value AS v FROM `{settings.gcp_project}.{settings.bigquery_dataset}.telemetry`
            WHERE machine_id = @m AND parameter = @p AND ts >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @s SECOND)
            ORDER BY ts"""
        job = bq.query(sql, job_config=bigquery.QueryJobConfig(query_parameters=[
            bigquery.ScalarQueryParameter("m", "STRING", machine_id), bigquery.ScalarQueryParameter("p", "STRING", parameter),
            bigquery.ScalarQueryParameter("s", "INT64", seconds)]))
        rows = [{"t": float(r.t), "v": float(r.v)} for r in job.result(timeout=20)]
        step = max(1, len(rows) // points)
        return rows[::step]
    except Exception as e:  # noqa: BLE001
        log.warning("bigquery query failed: %s", e)
        return []


# ---------- Cloud Storage ----------
def upload_manual(local_path: str, data: bytes, content_type: str) -> str | None:
    """Uploads synchronously (small files) and returns the gs:// URI, or None."""
    if not enabled() or not settings.gcs_bucket:
        return None
    st = _client("storage")
    if st is None:
        return None
    try:
        name = "manuals/" + local_path.split("/")[-1]
        st.bucket(settings.gcs_bucket).blob(name).upload_from_string(data, content_type=content_type)
        return f"gs://{settings.gcs_bucket}/{name}"
    except Exception as e:  # noqa: BLE001
        log.warning("gcs upload failed: %s", e)
        return None


# ---------- Cloud Logging ----------
def upload_blob(name: str, data: bytes, content_type: str) -> str | None:
    """Store bytes in the project bucket (evidence photos etc.). Returns the gs:// uri or None when GCS is off."""
    if not enabled() or not settings.gcs_bucket:
        return None
    try:
        st = _client("storage")
        st.bucket(settings.gcs_bucket).blob(name).upload_from_string(data, content_type=content_type)
        return f"gs://{settings.gcs_bucket}/{name}"
    except Exception as e:  # noqa: BLE001
        print("gcs upload failed:", e)
        return None


def download_blob(gcs_uri: str) -> bytes | None:
    if not enabled() or not gcs_uri.startswith("gs://"):
        return None
    try:
        bucket, _, name = gcs_uri[5:].partition("/")
        return _client("storage").bucket(bucket).blob(name).download_as_bytes()
    except Exception as e:  # noqa: BLE001
        print("gcs download failed:", e)
        return None


# ---------------------------------------------------------------- Firestore live mirror (selected collections)
# Row changes captured by SQLite triggers (db.SYNCED) are coalesced here and written to Firestore every few
# seconds. SQLite stays the primary store; see `snapshot_db` for how it persists on Cloud Run.

import shutil
import sqlite3
import tempfile
import time as _time
from pathlib import Path

_pending: dict[tuple[str, str], str] = {}  # (table, key) -> 'U' | 'D'
_pending_lock = threading.Lock()
_last_flush_key: dict[tuple[str, str], float] = {}
SLOW_TABLES = {"machines"}  # heartbeat every second; mirrored at most every 15 s per row
_sync_thread: threading.Thread | None = None
_stop = threading.Event()
_dirty = threading.Event()


def enqueue_changes(changes: list[tuple[str, str, str]]) -> None:
    _dirty.set()
    if not enabled():
        return
    with _pending_lock:
        for tbl, key, op in changes:
            _pending[(tbl, key)] = op


def mark_dirty() -> None:
    _dirty.set()


def _doc_data(r: dict[str, Any]) -> dict[str, Any]:
    return {**_clean(r), "_mirrored_at": datetime.now(timezone.utc)}


def flush_sync(force: bool = False) -> int:
    """Write coalesced row changes to Firestore. Returns the number of document writes."""
    if not enabled():
        return 0
    from .db import SYNCED, row_by_key

    db = _client("firestore")
    if db is None:
        return 0
    now_t = _time.time()
    with _pending_lock:
        take = []
        for (tbl, key), op in list(_pending.items()):
            if not force and tbl in SLOW_TABLES and op == "U" and now_t - _last_flush_key.get((tbl, key), 0) < 15:
                continue
            take.append(((tbl, key), op))
            _pending.pop((tbl, key), None)
            _last_flush_key[(tbl, key)] = now_t
    if not take:
        return 0
    n = 0
    batch = db.batch()
    for (tbl, key), op in take:
        if tbl not in SYNCED:
            continue
        ref = db.collection(tbl).document(str(key))
        r = None if op == "D" else row_by_key(tbl, key)
        if r is None:
            batch.delete(ref)
        else:
            batch.set(ref, _doc_data(r), merge=True)  # merge keeps the `latest` map written by mirror_latest
        n += 1
        if n % 400 == 0:
            batch.commit(); batch = db.batch()
    if n % 400:
        batch.commit()
    return n


# ---------------------------------------------------------------- SQLite persistence on Cloud Run
# The container disk is ephemeral, so the database is snapshotted to Cloud Storage: every minute when
# something changed (last hour of readings only; BigQuery keeps the full history), and on shutdown.
# A fresh container restores the latest snapshot before serving.
SNAPSHOT_EVERY = 180
READINGS_RETENTION_S = 3 * 3600  # charts show ≤ 1 h; BigQuery keeps the full history
SNAPSHOT_READINGS_S = 3600
_last_vacuum = 0.0
_last_snapshot = 0.0
_last_prune = 0.0


def _snapshot_blob_name() -> str:
    return "db/batchguard.db"


def snapshot_db() -> str | None:
    """Consistent copy of the live database (sqlite backup API) → trimmed → uploaded. Returns the gs:// uri."""
    if not enabled() or not settings.gcs_bucket or not settings.db_snapshot:
        return None
    from .db import conn

    global _last_vacuum
    tmp = Path(tempfile.mkdtemp(prefix="bgdb-")) / "snapshot.db"
    try:
        dst = sqlite3.connect(tmp)
        with dst:
            conn().backup(dst, pages=256, sleep=0.005)  # incremental: never holds the live database for long
        dst.execute("DELETE FROM readings WHERE ts < ?", (_time.time() - SNAPSHOT_READINGS_S,))
        dst.execute("DELETE FROM api_logs WHERE ts < ?", (_time.time() - 6 * 3600,))
        dst.execute("DELETE FROM _changes")
        dst.commit()
        if _time.time() - _last_vacuum > 3600:  # VACUUM is CPU-heavy; the copy is small enough to ship un-vacuumed in between
            dst.execute("VACUUM")
            _last_vacuum = _time.time()
        dst.close()
        st = _client("storage")
        if st is None:
            return None
        bucket = st.bucket(settings.gcs_bucket)
        bucket.blob(_snapshot_blob_name()).upload_from_filename(str(tmp), content_type="application/vnd.sqlite3")
        hour = _time.strftime("%Y%m%d-%H")
        hourly = bucket.blob(f"db/backups/batchguard-{hour}.db")
        if not hourly.exists():
            hourly.upload_from_filename(str(tmp), content_type="application/vnd.sqlite3")
        return f"gs://{settings.gcs_bucket}/{_snapshot_blob_name()}"
    finally:
        shutil.rmtree(tmp.parent, ignore_errors=True)


def restore_db_if_missing() -> bool:
    """On a fresh container (no local database yet) pull the latest snapshot from Cloud Storage."""
    if not enabled() or not settings.gcs_bucket or not settings.db_snapshot:
        return False
    if settings.db_file.exists() and settings.db_file.stat().st_size > 0:
        return False
    try:
        st = _client("storage")
        if st is None:
            return False
        blob = st.bucket(settings.gcs_bucket).blob(_snapshot_blob_name())
        if not blob.exists():
            return False
        settings.db_file.parent.mkdir(parents=True, exist_ok=True)
        blob.download_to_filename(str(settings.db_file))
        log.info("restored database snapshot from gs://%s/%s", settings.gcs_bucket, _snapshot_blob_name())
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("snapshot restore failed: %s", e)
        return False


def prune_readings() -> int:
    """Delete old readings in small batches so the write lock is never held for long."""
    from .db import tx

    cutoff = _time.time() - READINGS_RETENTION_S
    total = 0
    for _ in range(40):
        with tx(sync=False) as c:
            n = c.execute("DELETE FROM readings WHERE id IN (SELECT id FROM readings WHERE ts < ? LIMIT 5000)", (cutoff,)).rowcount
        total += n
        if n < 5000:
            break
        _time.sleep(0.05)
    with tx(sync=False) as c:
        c.execute("DELETE FROM api_logs WHERE ts < ?", (_time.time() - 2 * 86400,))
    return total


def _sync_loop() -> None:
    global _last_snapshot, _last_prune
    while not _stop.is_set():
        try:
            flush_sync()
        except Exception as e:  # noqa: BLE001
            log.warning("firestore sync failed: %s", e)
        now_t = _time.time()
        if now_t - _last_prune > 300:
            _last_prune = now_t
            try:
                prune_readings()
            except Exception as e:  # noqa: BLE001
                log.warning("prune failed: %s", e)
        if _dirty.is_set() and now_t - _last_snapshot > SNAPSHOT_EVERY:
            _dirty.clear()
            _last_snapshot = now_t
            try:
                snapshot_db()
            except Exception as e:  # noqa: BLE001
                log.warning("db snapshot failed: %s", e)
                _dirty.set()
        _stop.wait(5)


def start_sync() -> None:
    global _sync_thread
    if _sync_thread:
        return
    _stop.clear()
    _sync_thread = threading.Thread(target=_sync_loop, name="persist-sync", daemon=True)
    _sync_thread.start()


def stop_sync() -> None:
    _stop.set()
    try:
        flush_sync(force=True)
    except Exception as e:  # noqa: BLE001
        log.warning("final firestore flush failed: %s", e)
    try:
        snapshot_db()
    except Exception as e:  # noqa: BLE001
        log.warning("final db snapshot failed: %s", e)


def setup_logging() -> bool:
    if not enabled() or not settings.cloud_logging:
        return False
    try:
        import google.cloud.logging

        google.cloud.logging.Client(project=settings.gcp_project).setup_logging(log_level=logging.INFO)
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("cloud logging unavailable: %s", e)
        return False


def status() -> dict[str, Any]:
    return {
        "project": settings.gcp_project or None, "firestore": enabled(), "pubsub": enabled() and bool(settings.pubsub_topic_telemetry),
        "bigquery": enabled() and bool(settings.bigquery_dataset), "gcs": enabled() and bool(settings.gcs_bucket), "logging": enabled() and settings.cloud_logging,
    }
