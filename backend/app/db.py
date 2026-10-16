"""SQLite storage. One connection per request via `get_db()`; schema created on startup.

Kept deliberately plain (no ORM) so a Firestore/BigQuery adapter can replace the
few query helpers later without touching routers.
"""

import json
import sqlite3
import threading
from contextlib import contextmanager
from typing import Any, Iterator

from .config import settings

_lock = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, password_hash TEXT,
  provider TEXT NOT NULL DEFAULT 'password', photo_url TEXT, org_id TEXT, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_name TEXT, owner_email TEXT, phone TEXT,
  industry TEXT, size TEXT, timezone TEXT DEFAULT 'Asia/Singapore', use_cases TEXT DEFAULT '[]',
  onboarded INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT, phone TEXT, email TEXT,
  escalation_order INTEGER NOT NULL DEFAULT 1, quiet_start TEXT, quiet_end TEXT, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS lines (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS machines (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, line_id TEXT, name TEXT NOT NULL, type TEXT NOT NULL,
  location TEXT, status TEXT NOT NULL DEFAULT 'offline', device_id TEXT UNIQUE NOT NULL,
  api_key_hash TEXT, api_key_prefix TEXT, manual_name TEXT, manual_path TEXT, manual_text TEXT,
  knowledge TEXT DEFAULT '[]', source TEXT NOT NULL DEFAULT 'manual', verified INTEGER NOT NULL DEFAULT 0,
  verified_at REAL, position INTEGER NOT NULL DEFAULT 0, health INTEGER NOT NULL DEFAULT 100,
  last_seen REAL, created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS parameters (
  id TEXT PRIMARY KEY, machine_id TEXT NOT NULL, name TEXT NOT NULL, unit TEXT,
  normal_min REAL, normal_max REAL, warn_low REAL, warn_high REAL, crit_low REAL, crit_high REAL,
  sample_rate REAL, source_page INTEGER, source_snippet TEXT, confidence REAL, verified INTEGER NOT NULL DEFAULT 0,
  UNIQUE(machine_id, name)
);
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, machine_id TEXT NOT NULL, parameter TEXT NOT NULL,
  value REAL NOT NULL, unit TEXT, ts REAL NOT NULL, received_at REAL NOT NULL, reading_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_readings_mpt ON readings(machine_id, parameter, ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_readings_rid ON readings(machine_id, reading_id) WHERE reading_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS latest (
  machine_id TEXT NOT NULL, parameter TEXT NOT NULL, value REAL NOT NULL, unit TEXT, ts REAL NOT NULL,
  state TEXT NOT NULL DEFAULT 'normal', PRIMARY KEY(machine_id, parameter)
);
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, machine_id TEXT NOT NULL, type TEXT NOT NULL, message TEXT, severity TEXT DEFAULT 'info',
  ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_mt ON events(machine_id, ts);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, machine_id TEXT NOT NULL, severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', title TEXT NOT NULL, opened_at REAL NOT NULL, acknowledged_at REAL,
  acknowledged_by TEXT, resolved_at REAL, signals TEXT NOT NULL DEFAULT '[]', report TEXT, report_source TEXT,
  feedback TEXT, escalation_level INTEGER NOT NULL DEFAULT 0, last_escalated_at REAL
);
CREATE INDEX IF NOT EXISTS idx_incidents_org ON incidents(org_id, opened_at);
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, incident_id TEXT, channel TEXT NOT NULL, contact_id TEXT,
  to_addr TEXT, subject TEXT, body TEXT, status TEXT NOT NULL, sent_at REAL NOT NULL, read INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS workflows (
  org_id TEXT PRIMARY KEY, nodes TEXT NOT NULL DEFAULT '[]', edges TEXT NOT NULL DEFAULT '[]', updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL NOT NULL, route TEXT NOT NULL, method TEXT NOT NULL,
  status INTEGER NOT NULL, ms REAL NOT NULL, machine_id TEXT, org_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_api_logs_ts ON api_logs(ts);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, started_at REAL NOT NULL, finished_at REAL, source TEXT,
  tool_calls TEXT DEFAULT '[]', ok INTEGER NOT NULL DEFAULT 0, error TEXT
);
CREATE TABLE IF NOT EXISTS chat (
  id TEXT PRIMARY KEY, incident_id TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, ts REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS voice_settings (
  org_id TEXT PRIMARY KEY, telephony_configuration_id INTEGER, from_phone_number_id INTEGER, from_number TEXT,
  auto_dial INTEGER NOT NULL DEFAULT 0, workflows TEXT NOT NULL DEFAULT '{}', updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS voice_calls (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, incident_id TEXT, contact_id TEXT, contact_name TEXT, call_type TEXT NOT NULL,
  to_number TEXT NOT NULL, from_number TEXT, workflow_id INTEGER, workflow_uuid TEXT, run_id INTEGER, run_name TEXT,
  status TEXT NOT NULL, duration_seconds REAL, disposition TEXT, initial_context TEXT, gathered_context TEXT,
  transcript_url TEXT, recording_url TEXT, error TEXT, placed_by TEXT, applied INTEGER NOT NULL DEFAULT 0,
  created_at REAL NOT NULL, updated_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_calls_org ON voice_calls(org_id, created_at);
CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, incident_id TEXT NOT NULL, machine_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'photo',
  filename TEXT, path TEXT, gcs_uri TEXT, mime TEXT, caption TEXT, analysis TEXT, uploaded_by TEXT, ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_incident ON evidence(incident_id, ts);
CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, machine_id TEXT NOT NULL, incident_id TEXT, title TEXT NOT NULL, description TEXT,
  status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'medium', assignee TEXT, due_at REAL, source TEXT NOT NULL DEFAULT 'manual',
  position INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at REAL NOT NULL, updated_at REAL NOT NULL, done_at REAL
);
CREATE INDEX IF NOT EXISTS idx_work_orders_machine ON work_orders(machine_id, status);
"""


def _connect() -> sqlite3.Connection:
    settings.db_file.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.db_file, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


_local = threading.local()


def init_db() -> None:
    c = conn()
    c.executescript(SCHEMA)
    # additive migrations for databases created before these columns existed
    cols = {r["name"] for r in c.execute("PRAGMA table_info(latest)").fetchall()}
    if "forecast" not in cols:
        c.execute("ALTER TABLE latest ADD COLUMN forecast TEXT")
    c.commit()


def conn() -> sqlite3.Connection:
    """One connection per thread: sqlite3 connections are not safe to share across threads
    (request workers, the demo producer, the sweeper and agent threads all read concurrently).
    WAL mode lets readers proceed while one writer holds `_lock`."""
    c = getattr(_local, "conn", None)
    if c is None:
        c = _connect()
        _local.conn = c
    return c


@contextmanager
def tx() -> Iterator[sqlite3.Connection]:
    """Serialised write transaction."""
    with _lock:
        c = conn()
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise


def get_db() -> sqlite3.Connection:
    return conn()


def row(r: sqlite3.Row | None) -> dict[str, Any] | None:
    return dict(r) if r is not None else None


def rows(rs: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(r) for r in rs]


def j(v: Any) -> str:
    return json.dumps(v, separators=(",", ":"))


def uj(s: str | None, default: Any = None) -> Any:
    if not s:
        return default
    try:
        return json.loads(s)
    except Exception:
        return default
