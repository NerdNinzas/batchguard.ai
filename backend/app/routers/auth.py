from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field

from ..auth import clear_session, create_session, current_user, hash_password, verify_firebase_token, verify_password
from ..db import conn, row, tx
from ..ids import new_id, now

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class GoogleIn(BaseModel):
    id_token: str


def _public(u: dict[str, Any]) -> dict[str, Any]:
    org = row(conn().execute("SELECT * FROM orgs WHERE id=?", (u.get("org_id"),)).fetchone()) if u.get("org_id") else None
    return {
        "id": u["id"], "email": u["email"], "name": u["name"], "provider": u["provider"], "photo_url": u.get("photo_url"),
        "org": {**org, "use_cases": __import__("json").loads(org["use_cases"] or "[]")} if org else None,
    }


@router.post("/signup")
def signup(body: SignupIn, response: Response) -> dict[str, Any]:
    email = body.email.lower()
    if conn().execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        raise HTTPException(409, "An account with this email already exists")
    uid = new_id("usr")
    with tx() as c:
        c.execute(
            "INSERT INTO users (id, email, name, password_hash, provider, created_at) VALUES (?,?,?,?,?,?)",
            (uid, email, body.name.strip(), hash_password(body.password), "password", now()),
        )
    create_session(response, uid)
    return _public(row(conn().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()))


@router.post("/login")
def login(body: LoginIn, response: Response) -> dict[str, Any]:
    u = row(conn().execute("SELECT * FROM users WHERE email=?", (body.email.lower(),)).fetchone())
    if not u or not verify_password(body.password, u.get("password_hash")):
        raise HTTPException(401, "Wrong email or password")
    create_session(response, u["id"])
    return _public(u)


@router.post("/google")
def google(body: GoogleIn, response: Response) -> dict[str, Any]:
    claims = verify_firebase_token(body.id_token)
    email = claims["email"].lower()
    u = row(conn().execute("SELECT * FROM users WHERE email=?", (email,)).fetchone())
    if not u:
        uid = new_id("usr")
        with tx() as c:
            c.execute(
                "INSERT INTO users (id, email, name, provider, photo_url, created_at) VALUES (?,?,?,?,?,?)",
                (uid, email, claims.get("name") or email.split("@")[0], "google", claims.get("picture"), now()),
            )
        u = row(conn().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone())
    create_session(response, u["id"])
    return _public(u)


@router.post("/logout")
def logout(response: Response) -> dict[str, bool]:
    clear_session(response)
    return {"ok": True}


@router.get("/me")
def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return _public(user)
