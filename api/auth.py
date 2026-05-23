import os
import uuid
import json
import hmac
import hashlib
import base64
import bcrypt
import httpx
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)

JWT_SECRET = os.getenv("JWT_SECRET", "sovereign-dev-secret-change-in-prod")
JWT_EXPIRY = 30  # days

TURSO_URL   = os.getenv("TURSO_DATABASE_URL", "")
TURSO_TOKEN = os.getenv("TURSO_AUTH_TOKEN", "")


# ── Turso HTTP client ────────────────────────────────────────────────────────

def _turso(sql: str, args: list = None) -> list[dict]:
    """Execute a single SQL statement via Turso HTTP API. Returns rows as dicts."""
    if not TURSO_URL or not TURSO_TOKEN:
        raise RuntimeError("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are not configured — set them in Render environment variables")

    # Turso gives libsql:// URLs in the dashboard — HTTP API needs https://
    base_url = TURSO_URL.replace("libsql://", "https://", 1)

    stmt: dict = {"sql": sql}
    if args:
        stmt["args"] = [{"type": "text", "value": str(a)} if a is not None else {"type": "null"} for a in args]

    resp = httpx.post(
        f"{base_url}/v2/pipeline",
        headers={"Authorization": f"Bearer {TURSO_TOKEN}", "Content-Type": "application/json"},
        json={"requests": [{"type": "execute", "stmt": stmt}, {"type": "close"}]},
        timeout=10,
    )
    resp.raise_for_status()
    result = resp.json()["results"][0]
    if result.get("type") == "error":
        raise RuntimeError(result.get("error", {}).get("message", "Turso error"))

    cols = [c["name"] for c in result.get("response", {}).get("result", {}).get("cols", [])]
    rows = result.get("response", {}).get("result", {}).get("rows", [])
    return [dict(zip(cols, [v.get("value") for v in row])) for row in rows]


def _turso_setup():
    """Create users table and migrate schema if needed."""
    try:
        _turso("""
            CREATE TABLE IF NOT EXISTS users (
                id            TEXT PRIMARY KEY,
                email         TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                first_name    TEXT,
                last_name     TEXT,
                role          TEXT,
                groq_api_key  TEXT,
                created_at    TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        # Migrate existing tables that may be missing the new columns
        for col, defn in [("first_name", "TEXT"), ("last_name", "TEXT"), ("role", "TEXT")]:
            try:
                _turso(f"ALTER TABLE users ADD COLUMN {col} {defn}")
            except Exception:
                pass  # column already exists
    except Exception as e:
        print(f"[auth] Turso setup warning: {e}")


# ── JWT (stdlib only — no cryptography dep) ──────────────────────────────────

def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def _b64url_decode(s: str) -> bytes:
    pad = 4 - len(s) % 4
    return base64.urlsafe_b64decode(s + "=" * (pad % 4))

def _make_token(user_id: str, email: str) -> str:
    header  = _b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url(json.dumps({
        "sub": user_id,
        "email": email,
        "exp": int((datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRY)).timestamp()),
    }).encode())
    sig = _b64url(hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{sig}"

def _decode_token(token: str) -> dict:
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("invalid token")
    header, payload, sig = parts
    expected = _b64url(hmac.new(JWT_SECRET.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        raise ValueError("invalid signature")
    data = json.loads(_b64url_decode(payload))
    if data.get("exp", 0) < datetime.now(timezone.utc).timestamp():
        raise ValueError("token expired")
    return data


# ── FastAPI auth helpers ──────────────────────────────────────────────────────

def get_current_user(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict | None:
    if not creds:
        return None
    try:
        data = _decode_token(creds.credentials)
        return {"id": data["sub"], "email": data["email"]}
    except Exception:
        return None

def require_user(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    user = get_current_user(creds)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


# ── Request models ────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: str
    password: str
    first_name: str = ""
    last_name: str = ""
    role: str = ""

class LoginRequest(BaseModel):
    email: str
    password: str

class UpdateKeyRequest(BaseModel):
    groq_api_key: str


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/register")
def register(req: RegisterRequest):
    if len(req.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    email = req.email.strip().lower()
    try:
        existing = _turso("SELECT id FROM users WHERE email = ?", [email])
        if existing:
            raise HTTPException(409, "An account with that email already exists")
        pw_hash = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()
        user_id = str(uuid.uuid4())
        _turso(
            "INSERT INTO users (id, email, password_hash, first_name, last_name, role) VALUES (?, ?, ?, ?, ?, ?)",
            [user_id, email, pw_hash, req.first_name.strip(), req.last_name.strip(), req.role.strip()],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Registration failed: {e}")
    token = _make_token(user_id, email)
    return {"token": token, "email": email, "first_name": req.first_name.strip(), "last_name": req.last_name.strip(), "groq_api_key": None}


@router.post("/login")
def login(req: LoginRequest):
    email = req.email.strip().lower()
    try:
        rows = _turso("SELECT id, email, password_hash, groq_api_key FROM users WHERE email = ?", [email])
    except Exception as e:
        raise HTTPException(500, f"Login failed: {e}")
    if not rows or not bcrypt.checkpw(req.password.encode(), rows[0]["password_hash"].encode()):
        raise HTTPException(401, "Invalid email or password")
    row = rows[0]
    token = _make_token(row["id"], row["email"])
    return {"token": token, "email": row["email"], "groq_api_key": row.get("groq_api_key")}


@router.get("/me")
def me(user: dict = Depends(require_user)):
    try:
        rows = _turso("SELECT email, groq_api_key FROM users WHERE id = ?", [user["id"]])
    except Exception as e:
        raise HTTPException(500, f"Lookup failed: {e}")
    if not rows:
        raise HTTPException(404, "User not found")
    return {"email": rows[0]["email"], "groq_api_key": rows[0].get("groq_api_key")}


@router.post("/update-key")
def update_key(req: UpdateKeyRequest, user: dict = Depends(require_user)):
    val = req.groq_api_key.strip() or None
    try:
        _turso("UPDATE users SET groq_api_key = ? WHERE id = ?", [val, user["id"]])
    except Exception as e:
        raise HTTPException(500, f"Update failed: {e}")
    return {"ok": True}


@router.post("/logout")
def logout():
    return {"ok": True}
