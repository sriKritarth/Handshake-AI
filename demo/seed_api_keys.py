"""Seed demo API keys into Supabase api_keys table.

Run once before starting the server:
    python demo/seed_api_keys.py

Keys are shown exactly once — save them immediately.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import sys
from pathlib import Path

import dotenv
import httpx

from dotenv import load_dotenv
load_dotenv(dotenv_path='.env')
# Allow importing from backend/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from supabase import ClientOptions, create_client

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ.get("SUPABASE_SECRET_KEY") or os.environ["SUPABASE_PUBLISHABLE_KEY"],
    options=ClientOptions(httpx_client=httpx.Client(timeout=httpx.Timeout(30.0, connect=10.0))),
)


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_api_key() -> tuple[str, str]:
    raw = secrets.token_urlsafe(32)
    return raw, hash_key(raw)


DEMO_CLIENTS = [
    {
        "client_name": "buyer-agent-demo",
        "scopes": ["buyer:negotiate", "buyer:accept", "buyer:decline", "session:read"],
    },
    {
        "client_name": "merchant-dashboard",
        "scopes": ["merchant:approve", "merchant:reject", "merchant:counter", "session:read"],
    },
    {
        "client_name": "admin-demo",
        "scopes": [
            "admin:create_session", "session:read", "audit:read",
            "buyer:negotiate", "buyer:accept", "buyer:decline",
        ],
    },
]


KEY_ENV_MAP = {
    "admin-demo": "ADMIN_KEY",
    "buyer-agent-demo": "BUYER_KEY",
    "merchant-dashboard": "MERCHANT_KEY",
}


def main() -> None:
    print("=" * 55)
    print("  API Key Setup")
    print("=" * 55)

    env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(dotenv_path=env_path, override=True)

    seeded_keys = {}

    for entry in DEMO_CLIENTS:
        env_var = KEY_ENV_MAP.get(entry["client_name"])
        existing_key = os.getenv(env_var) if env_var else None

        if existing_key and len(existing_key.strip()) > 10:
            raw_key = existing_key.strip()
            hashed = hash_key(raw_key)
            action = "synced from .env"
        else:
            raw_key, hashed = generate_api_key()
            action = "generated"

        seeded_keys[env_var] = raw_key

        # Check if key exists for client in DB
        res = supabase.table("api_keys").select("id").eq("client_name", entry["client_name"]).execute()

        if res and res.data:
            supabase.table("api_keys").update({
                "key_hash": hashed,
                "scopes": entry["scopes"],
                "is_active": True,
            }).eq("client_name", entry["client_name"]).execute()
        else:
            supabase.table("api_keys").insert({
                "key_hash": hashed,
                "client_name": entry["client_name"],
                "scopes": entry["scopes"],
                "is_active": True,
            }).execute()

        print(f"\nClient : {entry['client_name']}  [{action}]")
        print(f"Scopes : {entry['scopes']}")
        print(f"Key    : {raw_key}")

    # Automatically save keys to .env
    for var_name, key_val in seeded_keys.items():
        if var_name:
            dotenv.set_key(str(env_path), var_name, key_val)

    print("\n" + "=" * 55)
    print(f"Keys successfully synchronized and saved into {env_path.name}!")
    print("  $env:BUYER_KEY = '<buyer-agent-demo key above>'")


if __name__ == "__main__":
    main()
