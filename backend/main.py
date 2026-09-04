"""FastAPI application entry point for the B2B Negotiation Agent API.

Run with:
    uvicorn backend.main:app --reload --port 8000

OpenAPI docs: http://localhost:8000/docs
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

import structlog
from dotenv import load_dotenv

_backend_dir = Path(__file__).resolve().parent
_root_dir = _backend_dir.parent

load_dotenv(_root_dir / ".env", override=True)

if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

# ---------------------------------------------------------------------------
# Structured logging — configure ONCE before anything else imports a logger
# ---------------------------------------------------------------------------

structlog.configure(
    processors=[
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
)

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from supabase import ClientOptions, create_client

from api.auth import make_auth_dependency
from api.routes import router
from session.db import SupabaseSessionRepository
from session.service import NegotiationSessionService

# ---------------------------------------------------------------------------
# Supabase client
# ---------------------------------------------------------------------------

_supabase_url = os.getenv("SUPABASE_URL", "")
_supabase_key = os.getenv("SUPABASE_SECRET_KEY") or os.getenv("SUPABASE_PUBLISHABLE_KEY", "")

supabase = create_client(
    _supabase_url,
    _supabase_key,
    options=ClientOptions(httpx_client=httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0))),
)

# ---------------------------------------------------------------------------
# Rate limiter
# ---------------------------------------------------------------------------

limiter = Limiter(key_func=lambda r: r.headers.get("X-API-Key", r.client.host))

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="B2B Negotiation Agent API",
    description=(
        "Agent-to-Agent wholesale price negotiation with Razorpay settlement. "
        "Authenticate with X-API-Key header."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Auth middleware — validates X-API-Key and attaches AuthenticatedClient
# to request.state before the route handler runs.
# ---------------------------------------------------------------------------

_verify_key = make_auth_dependency(supabase)

UNPROTECTED_PATHS = {"/", "/favicon.ico", "/api/v1/health", "/docs", "/redoc", "/openapi.json"}


@app.get("/", include_in_schema=False)
async def root():
    return {
        "name": "B2B Negotiation Agent API",
        "status": "online",
        "docs_url": "/docs",
        "health_url": "/api/v1/health",
    }


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Skip auth for root / health / docs / favicon / checkout
    if (
        request.url.path in UNPROTECTED_PATHS
        or request.url.path.startswith("/api/v1/checkout/")
        or request.method == "OPTIONS"
    ):
        return await call_next(request)

    raw_key = request.headers.get("X-API-Key")
    if not raw_key:
        return JSONResponse(status_code=401, content={"detail": "X-API-Key header missing"})

    try:
        auth_client = await _verify_key(raw_key)
    except Exception as exc:
        status = getattr(exc, "status_code", 401)
        detail = getattr(exc, "detail", "Invalid API key")
        return JSONResponse(status_code=status, content={"detail": detail})

    request.state.auth_client = auth_client
    return await call_next(request)


# ---------------------------------------------------------------------------
# Service dependency — injected into request.state for each request
# ---------------------------------------------------------------------------

@app.middleware("http")
async def service_middleware(request: Request, call_next):
    repo = SupabaseSessionRepository()
    request.state.service = NegotiationSessionService(repo=repo)
    return await call_next(request)


# ---------------------------------------------------------------------------
# Include routes
# ---------------------------------------------------------------------------

app.include_router(router)
