from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import cloud
from ..auth import current_org, current_user
from ..db import conn, j, row, rows, tx, uj
from ..ids import new_id, now

router = APIRouter(prefix="/api", tags=["org"])


class OrgIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    owner_name: str = Field(min_length=1, max_length=80)
    owner_email: str
    phone: str = ""
    industry: str = ""
    size: str = ""
    timezone: str = "Asia/Singapore"


class UseCasesIn(BaseModel):
    use_cases: list[str]


class ContactIn(BaseModel):
    name: str = Field(min_length=1)
    role: str = ""
    phone: str = ""
    email: str = ""
    escalation_order: int = 1
    quiet_start: str | None = None
    quiet_end: str | None = None


def _org_out(o: dict[str, Any]) -> dict[str, Any]:
    return {**o, "use_cases": uj(o.get("use_cases"), [])}


@router.post("/org")
def create_org(body: OrgIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if user.get("org_id"):
        with tx() as c:
            c.execute(
                "UPDATE orgs SET name=?, owner_name=?, owner_email=?, phone=?, industry=?, size=?, timezone=? WHERE id=?",
                (body.name, body.owner_name, body.owner_email, body.phone, body.industry, body.size, body.timezone, user["org_id"]),
            )
        return _org_out(row(conn().execute("SELECT * FROM orgs WHERE id=?", (user["org_id"],)).fetchone()))
    oid = new_id("org")
    lid = new_id("line")
    with tx() as c:
        c.execute(
            "INSERT INTO orgs (id, name, owner_name, owner_email, phone, industry, size, timezone, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (oid, body.name, body.owner_name, body.owner_email, body.phone, body.industry, body.size, body.timezone, user["id"], now()),
        )
        c.execute("INSERT INTO lines (id, org_id, name, created_at) VALUES (?,?,?,?)", (lid, oid, "Line A", now()))
        c.execute("INSERT INTO workflows (org_id, nodes, edges, updated_at) VALUES (?,?,?,?)", (oid, "[]", "[]", now()))
        c.execute("UPDATE users SET org_id=? WHERE id=?", (oid, user["id"]))
    org = _org_out(row(conn().execute("SELECT * FROM orgs WHERE id=?", (oid,)).fetchone()))
    cloud.mirror("orgs", oid, org)
    return org


@router.get("/org")
def get_org(org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    return _org_out(org)


@router.put("/org/use-cases")
def set_use_cases(body: UseCasesIn, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    with tx() as c:
        c.execute("UPDATE orgs SET use_cases=? WHERE id=?", (j(body.use_cases), org["id"]))
    return {"ok": True, "use_cases": body.use_cases}


@router.post("/org/complete-onboarding")
def complete(org: dict[str, Any] = Depends(current_org), user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    first = not org.get("onboarded")
    with tx() as c:
        c.execute("UPDATE orgs SET onboarded=1 WHERE id=?", (org["id"],))
    if first:
        try:
            from .. import notify

            notify.on_welcome(org, user)
        except Exception as e:  # noqa: BLE001
            print("welcome mail error:", e)
    return {"ok": True}


@router.post("/org/purge-telemetry")
def purge_telemetry(org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    """Wipe this org's telemetry history and everything derived from it (readings, latest values, events, incidents,
    investigations, chat, photo evidence, notifications). Machines, contacts, work orders, voice calls and settings stay.
    Used to start clean when a real device / the virtual simulator takes over from the built-in demo producer."""
    mids = [r["id"] for r in conn().execute("SELECT id FROM machines WHERE org_id=?", (org["id"],)).fetchall()]
    counts: dict[str, int] = {}
    with tx() as c:
        if mids:
            ph = ",".join("?" * len(mids))
            for tbl in ("readings", "latest", "events"):
                counts[tbl] = c.execute(f"DELETE FROM {tbl} WHERE machine_id IN ({ph})", mids).rowcount
            iids = [r["id"] for r in c.execute(f"SELECT id FROM incidents WHERE machine_id IN ({ph})", mids).fetchall()]
            if iids:
                iph = ",".join("?" * len(iids))
                for tbl in ("agent_runs", "chat", "evidence"):
                    counts[tbl] = c.execute(f"DELETE FROM {tbl} WHERE incident_id IN ({iph})", iids).rowcount
            counts["incidents"] = c.execute(f"DELETE FROM incidents WHERE machine_id IN ({ph})", mids).rowcount
            c.execute(f"UPDATE machines SET status='offline', health=100, last_seen=NULL WHERE id IN ({ph})", mids)
        counts["notifications"] = c.execute("DELETE FROM notifications WHERE org_id=?", (org["id"],)).rowcount
        counts["api_logs"] = c.execute("DELETE FROM api_logs").rowcount
    cloud.mark_dirty()
    return {"ok": True, "deleted": counts}


# ---------- contacts ----------
@router.get("/contacts")
def list_contacts(org: dict[str, Any] = Depends(current_org)) -> list[dict[str, Any]]:
    return rows(conn().execute("SELECT * FROM contacts WHERE org_id=? ORDER BY escalation_order, created_at", (org["id"],)).fetchall())


@router.post("/contacts")
def add_contact(body: ContactIn, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    cid = new_id("ctc")
    with tx() as c:
        c.execute(
            "INSERT INTO contacts (id, org_id, name, role, phone, email, escalation_order, quiet_start, quiet_end, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (cid, org["id"], body.name, body.role, body.phone, body.email, body.escalation_order, body.quiet_start, body.quiet_end, now()),
        )
    c_ = row(conn().execute("SELECT * FROM contacts WHERE id=?", (cid,)).fetchone())
    cloud.mirror("contacts", cid, c_)
    return c_


@router.put("/contacts/{cid}")
def update_contact(cid: str, body: ContactIn, org: dict[str, Any] = Depends(current_org)) -> dict[str, Any]:
    with tx() as c:
        r = c.execute(
            "UPDATE contacts SET name=?, role=?, phone=?, email=?, escalation_order=?, quiet_start=?, quiet_end=? WHERE id=? AND org_id=?",
            (body.name, body.role, body.phone, body.email, body.escalation_order, body.quiet_start, body.quiet_end, cid, org["id"]),
        )
        if r.rowcount == 0:
            raise HTTPException(404, "Contact not found")
    return row(conn().execute("SELECT * FROM contacts WHERE id=?", (cid,)).fetchone())


@router.delete("/contacts/{cid}")
def delete_contact(cid: str, org: dict[str, Any] = Depends(current_org)) -> dict[str, bool]:
    with tx() as c:
        c.execute("DELETE FROM contacts WHERE id=? AND org_id=?", (cid, org["id"]))
    return {"ok": True}
