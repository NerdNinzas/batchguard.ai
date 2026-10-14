import secrets
import string
import time

_ALPHA = string.ascii_lowercase + string.digits


def new_id(prefix: str) -> str:
    return f"{prefix}_{''.join(secrets.choice(_ALPHA) for _ in range(12))}"


def new_device_id(name: str) -> str:
    slug = "".join(ch if ch.isalnum() else "-" for ch in name.lower()).strip("-")[:16] or "machine"
    return f"{slug}-{''.join(secrets.choice(string.digits) for _ in range(2))}{secrets.choice(string.ascii_lowercase)}"


def new_api_key() -> str:
    return "bg_live_" + secrets.token_urlsafe(32)


def now() -> float:
    return time.time()
