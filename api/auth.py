import os
import uuid
import json
import hmac
import hashlib
import base64
import bcrypt
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)

JWT_SECRET = os.getenv("JWT_SECRET", "sovereign-dev-secret-change-in-prod")
JWT_EXPIRY = 30  # days


# ── DuckDB helpers ────────────────────────────────────────────────────────────

def _db():
    """Return the shared DuckDB connection for this thread."""
    from db import get_conn
    return get_conn()


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
        conn = _db()
        existing = conn.execute("SELECT id FROM users WHERE email = ?", [email]).fetchone()
        if existing:
            raise HTTPException(409, "An account with that email already exists")
        pw_hash = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()
        user_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)",
            [user_id, email, pw_hash],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Registration failed: {e}")
    token = _make_token(user_id, email)
    return {"token": token, "email": email, "groq_api_key": None}


@router.post("/login")
def login(req: LoginRequest):
    email = req.email.strip().lower()
    try:
        conn = _db()
        row = conn.execute(
            "SELECT id, email, password_hash, groq_api_key FROM users WHERE email = ?",
            [email],
        ).fetchone()
    except Exception as e:
        raise HTTPException(500, f"Login failed: {e}")
    if not row or not bcrypt.checkpw(req.password.encode(), row[2].encode()):
        raise HTTPException(401, "Invalid email or password")
    token = _make_token(row[0], row[1])
    return {"token": token, "email": row[1], "groq_api_key": row[3]}


@router.get("/me")
def me(user: dict = Depends(require_user)):
    try:
        conn = _db()
        row = conn.execute(
            "SELECT email, groq_api_key FROM users WHERE id = ?",
            [user["id"]],
        ).fetchone()
    except Exception as e:
        raise HTTPException(500, f"Lookup failed: {e}")
    if not row:
        raise HTTPException(404, "User not found")
    return {"email": row[0], "groq_api_key": row[1]}


@router.post("/update-key")
def update_key(req: UpdateKeyRequest, user: dict = Depends(require_user)):
    val = req.groq_api_key.strip() or None
    try:
        conn = _db()
        conn.execute("UPDATE users SET groq_api_key = ? WHERE id = ?", [val, user["id"]])
    except Exception as e:
        raise HTTPException(500, f"Update failed: {e}")
    return {"ok": True}


@router.post("/logout")
def logout():
    return {"ok": True}
