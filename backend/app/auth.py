"""Sessions (JWT cookie), password hashing (scrypt, stdlib), device keys, Firebase ID tokens."""

import hashlib
import hmac
import os
import time
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request, Response

from .config import settings
from .db import conn, row

COOKIE = "bg_session"
SESSION_DAYS = 14


# ---------- passwords ----------
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored or not stored.startswith("scrypt$"):
        return False
    _, salt_hex, digest_hex = stored.split("$")
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2**14, r=8, p=1)
    return hmac.compare_digest(digest.hex(), digest_hex)


# ---------- device keys ----------
def hash_api_key(key: str) -> str:
    return hashlib.sha256((settings.auth_secret + key).encode()).hexdigest()


# ---------- sessions ----------
def create_session(response: Response, user_id: str) -> None:
    exp = int(time.time()) + SESSION_DAYS * 86400
    token = jwt.encode({"sub": user_id, "exp": exp}, settings.auth_secret, algorithm="HS256")
    response.set_cookie(COOKIE, token, httponly=True, samesite="lax", max_age=SESSION_DAYS * 86400, path="/")


def clear_session(response: Response) -> None:
    response.delete_cookie(COOKIE, path="/")


def current_user_optional(request: Request) -> dict[str, Any] | None:
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    try:
        data = jwt.decode(token, settings.auth_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return row(conn().execute("SELECT * FROM users WHERE id=?", (data["sub"],)).fetchone())


def current_user(request: Request) -> dict[str, Any]:
    user = current_user_optional(request)
    if not user:
        raise HTTPException(401, "Not signed in")
    return user


def current_org(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    if not user.get("org_id"):
        raise HTTPException(409, "No organisation yet — finish onboarding")
    org = row(conn().execute("SELECT * FROM orgs WHERE id=?", (user["org_id"],)).fetchone())
    if not org:
        raise HTTPException(409, "Organisation missing")
    return org


# ---------- Firebase (Google sign-in) ----------
def verify_firebase_token(id_token: str) -> dict[str, Any]:
    """Verify a Firebase ID token using Google's public certs; needs only the project id."""
    if not settings.firebase_project_id:
        raise HTTPException(501, "Google sign-in not configured (FIREBASE_PROJECT_ID)")
    try:
        from google.auth.transport import requests as g_requests
        from google.oauth2 import id_token as g_id_token

        claims = g_id_token.verify_firebase_token(id_token, g_requests.Request(), audience=settings.firebase_project_id)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(401, f"Invalid Google token: {e}") from e
    if not claims or not claims.get("email"):
        raise HTTPException(401, "Google token has no email")
    return claims
