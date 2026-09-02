# Single-service image: build the React bundle, then serve it and the API from one
# uvicorn process. Railway mounts a volume at /data so DuckDB actually persists and the
# ingest scheduler can do real work — which is the whole reason for moving off
# serverless. See api/db.py for the first-boot seeding.

# ── Stage 1: frontend ────────────────────────────────────────────────────────
FROM node:22-slim AS web

WORKDIR /build
# Copy manifests first so a source-only change does not re-run npm ci.
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY web/ ./
# No VITE_API_URL: the API is same-origin here, so the client's default /api is correct.
RUN npm run build


# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DATABASE_PATH=/data/sovereign.duckdb

WORKDIR /app

# curl is used by the healthcheck below; nothing else needs a compiler.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

COPY api/requirements.txt ./api/requirements.txt
RUN pip install -r api/requirements.txt

COPY api/ ./api/
COPY --from=web /build/dist ./web/dist

# Mount point for the Railway volume. Declared so the image still runs without one.
RUN mkdir -p /data

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/api/health" || exit 1

# Railway injects PORT. One worker on purpose: DuckDB is single-writer, and a second
# worker would fight the first for the lock on the volume.
CMD ["sh", "-c", "cd api && exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
