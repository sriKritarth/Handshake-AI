"""API-key + scope authentication for the negotiation API."""
from __future__ import annotations

import hashlib
import secrets
from typing import List

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


# ---------------------------------------------------------------------------
# Key utilities
# ---------------------------------------------------------------------------

def hash_key(raw_key: str) -> str:
    """SHA-256 hash of a raw API key (store this, not the raw key)."""
    return hashlib.sha256(raw_key.encode()).hexdigest()


def generate_api_key() -> tuple[str, str]:
    """Generate a new API key. Returns (raw_key, key_hash).

    Show raw_key to the client exactly once. Store key_hash only.
    """
    raw = secrets.token_urlsafe(32)
    return raw, hash_key(raw)


# ---------------------------------------------------------------------------
# Authenticated client representation
# ---------------------------------------------------------------------------

class AuthenticatedClient:
    """Represents a verified API client with its granted scopes."""

    def __init__(self, client_name: str, scopes: List[str]) -> None:
        self.client_name = client_name
        self.scopes = scopes

    def has_scope(self, scope: str) -> bool:
        return scope in self.scopes

    def require_scope(self, scope: str) -> None:
        """Raise HTTP 403 if the client does not hold *scope*."""
        if not self.has_scope(scope):
            raise HTTPException(
                status_code=403,
                detail=f"Missing required scope: {scope}",
            )


# ---------------------------------------------------------------------------
# FastAPI dependency factories
# ---------------------------------------------------------------------------

def make_auth_dependency(supabase_client):
    """Return a FastAPI dependency that validates X-API-Key against Supabase.

    Usage in routes:
        client: AuthenticatedClient = Depends(make_auth_dependency(supabase))
    """

    async def verify_api_key(
        raw_key: str = Security(api_key_header),
    ) -> AuthenticatedClient:
        if not raw_key:
            raise HTTPException(status_code=401, detail="X-API-Key header missing")
        clean_key = raw_key.strip().strip("'\"")
        if clean_key.lower().startswith("bearer "):
            clean_key = clean_key[7:].strip()
        hashed = hash_key(clean_key)

        result = (
            supabase_client.table("api_keys")
            .select("client_name, scopes, is_active")
            .eq("key_hash", hashed)
            .eq("is_active", True)
            .execute()
        )

        if not result or not result.data:
            raise HTTPException(status_code=401, detail="Invalid or inactive API key")

        row = result.data[0]

        # Fire-and-forget last_used_at update — don't block the request
        try:
            supabase_client.table("api_keys").update(
                {"last_used_at": "now()"}
            ).eq("key_hash", hashed).execute()
        except Exception:
            pass  # non-critical

        return AuthenticatedClient(
            client_name=row["client_name"],
            scopes=row["scopes"] or [],
        )

    return verify_api_key


def make_test_auth_dependency(client_name: str, scopes: List[str]):
    """Return a no-op auth dependency for unit tests (bypasses Supabase)."""

    async def _stub(raw_key: str = Security(api_key_header)) -> AuthenticatedClient:
        return AuthenticatedClient(client_name=client_name, scopes=scopes)

    return _stub
