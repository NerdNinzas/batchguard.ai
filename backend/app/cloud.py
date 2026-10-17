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


# ---------------------------------------------------------------- Firestore as the system of record
# Row changes captured by SQLite triggers (db.SYNCED) are coalesced here and written to Firestore every
# few seconds; readings are batched into 10-second documents; on start, `hydrate()` rebuilds the local
# SQLite copy from Firestore so a fresh Cloud Run container carries on exactly where the last one stopped.

import time as _time

_pending: dict[tuple[str, str], str] = {}  # (table, key) -> 'U' | 'D'
_pending_lock = threading.Lock()
_last_flush_key: dict[tuple[str, str], float] = {}
SLOW_TABLES = {"latest", "machines"}  # change every second; flushed at most every 15 s per row
_reading_buf: dict[str, list[dict[str, Any]]] = {}
_sync_thread: threading.Thread | None = None
_stop = threading.Event()
READING_BUCKET = 10
READING_RETENTION_S = 3600


def enqueue_changes(changes: list[tuple[str, str, str]]) -> None:
    if not enabled():
        return
    with _pending_lock:
        for tbl, key, op in changes:
            _pending[(tbl, key)] = op


def buffer_readings(machine_id: str, rows_: list[dict[str, Any]]) -> None:
    if not enabled() or not rows_:
        return
    with _pending_lock:
        _reading_buf.setdefault(machine_id, []).extend(rows_)


def _doc_data(r: dict[str, Any]) -> dict[str, Any]:
    return {**_clean(r), "_mirrored_at": datetime.now(timezone.utc)}


def flush_sync(force: bool = False) -> int:
    """Write coalesced row changes + reading batches to Firestore. Returns number of writes."""
    if not enabled():
        return 0
    from .db import SYNCED, row_by_key

    db = _client("firestore")
    if db is None:
        return 0
    now_t = _time.time()
    with _pending_lock:
        items = list(_pending.items())
        take = []
        for (tbl, key), op in items:
            if not force and tbl in SLOW_TABLES and op == "U" and now_t - _last_flush_key.get((tbl, key), 0) < 15:
                continue
            take.append(((tbl, key), op))
            _pending.pop((tbl, key), None)
            _last_flush_key[(tbl, key)] = now_t
        readings = {k: v for k, v in _reading_buf.items() if v}
        _reading_buf.clear()
    n = 0
    batch = db.batch()
    for (tbl, key), op in take:
        if tbl not in SYNCED:
            continue
        ref = db.collection(tbl).document(str(key))
        if op == "D":
            batch.delete(ref)
        else:
            r = row_by_key(tbl, key)
            if r is None:
                batch.delete(ref)
            else:
                batch.set(ref, _doc_data(r), merge=False)
        n += 1
        if n % 400 == 0:
            batch.commit(); batch = db.batch()
    for mid, rs in readings.items():
        bucket = int(rs[-1]["ts"] // READING_BUCKET) * READING_BUCKET
        ref = db.collection("reading_batches").document(f"{mid}__{bucket}")
        batch.set(ref, {"machine_id": mid, "bucket": bucket, "rows": rs[-600:], "expires_at": datetime.now(timezone.utc) + timedelta(hours=2)}, merge=False)
        n += 1
        if n % 400 == 0:
            batch.commit(); batch = db.batch()
    if n:
        batch.commit()
    return n


def _sync_loop() -> None:
    while not _stop.is_set():
        try:
            flush_sync()
        except Exception as e:  # noqa: BLE001
            log.warning("firestore sync failed: %s", e)
        _stop.wait(5)


def start_sync() -> None:
    global _sync_thread
    if not enabled() or _sync_thread:
        return
    _stop.clear()
    _sync_thread = threading.Thread(target=_sync_loop, name="firestore-sync", daemon=True)
    _sync_thread.start()


def stop_sync() -> None:
    _stop.set()
    try:
        flush_sync(force=True)
    except Exception as e:  # noqa: BLE001
        log.warning("final firestore flush failed: %s", e)


def _sqlite_value(v: Any) -> Any:
    if isinstance(v, (dict, list)):
        return json.dumps(v, default=str)
    if isinstance(v, datetime):
        return v.timestamp()
    if isinstance(v, bool):
        return int(v)
    return v


def hydrate() -> dict[str, int]:
    """Rebuild the local SQLite copy from Firestore (rows + the last hour of readings)."""
    if not enabled():
        return {}
    from .db import SYNCED, table_columns, tx

    db = _client("firestore")
    if db is None:
        return {}
    counts: dict[str, int] = {}
    from .db import conn as _conn

    for tbl in SYNCED:
        info = _conn().execute(f"PRAGMA table_info({tbl})").fetchall()
        cols = {r["name"] for r in info}
        required = {r["name"] for r in info if r["notnull"] and r["dflt_value"] is None and not r["pk"]}
        pk_expr = SYNCED[tbl]
        docs = list(db.collection(tbl).stream())
        if not docs:
            continue
        n = 0
        with tx(sync=False) as c:
            for d in docs:
                data = {k: _sqlite_value(v) for k, v in d.to_dict().items() if k in cols}
                if not data:
                    continue
                if "||" in pk_expr:
                    where, args = "machine_id=? AND parameter=?", (data.get("machine_id"), data.get("parameter"))
                else:
                    where, args = f"{pk_expr}=?", (data.get(pk_expr) or d.id,)
                    data.setdefault(pk_expr, d.id)
                exists = c.execute(f"SELECT 1 FROM {tbl} WHERE {where}", args).fetchone()
                if exists:
                    sets = [k for k in data if k not in ("id",)]
                    if sets:
                        c.execute(f"UPDATE {tbl} SET {', '.join(f'{k}=?' for k in sets)} WHERE {where}", [data[k] for k in sets] + list(args))
                elif required <= set(data):
                    keys = list(data)
                    c.execute(f"INSERT INTO {tbl} ({', '.join(keys)}) VALUES ({', '.join('?' * len(keys))})", [data[k] for k in keys])
                else:
                    continue  # a partial legacy mirror doc for a row we no longer have; the next write-through replaces it
                n += 1
        counts[tbl] = n
    try:
        since = _time.time() - READING_RETENTION_S
        q = db.collection("reading_batches").where("bucket", ">=", since)
        n = 0
        with tx(sync=False) as c:
            for d in q.stream():
                doc = d.to_dict()
                for r in doc.get("rows", []):
                    if c.execute("SELECT 1 FROM readings WHERE machine_id=? AND parameter=? AND ts=?", (doc["machine_id"], r["parameter"], r["ts"])).fetchone():
                        continue
                    c.execute("INSERT INTO readings (machine_id, parameter, value, unit, ts, received_at, reading_id) VALUES (?,?,?,?,?,?,?)",
                              (doc["machine_id"], r["parameter"], r["value"], r.get("unit"), r["ts"], r.get("received_at", r["ts"]), r.get("reading_id")))
                    n += 1
        counts["readings"] = n
    except Exception as e:  # noqa: BLE001
        log.warning("reading hydrate failed: %s", e)
    log.info("hydrated from firestore: %s", counts)
    return counts


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
