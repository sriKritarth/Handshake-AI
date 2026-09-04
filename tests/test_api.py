"""Phase 6 API endpoint tests using FastAPI TestClient with InMemory repo.

All tests use a test-only app fixture that:
  - Wires InMemorySessionRepository (no Supabase calls)
  - Uses make_test_auth_dependency() to bypass real key lookup
  - Uses MockDecisionLLMClient for deterministic LLM responses

Run with:
    pytest tests/test_api.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

# Make backend importable
_BACKEND = Path(__file__).resolve().parent.parent / "backend"
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from api.auth import AuthenticatedClient, make_test_auth_dependency
from api.routes import router
from session.db import InMemorySessionRepository
from session.models import NegotiationDecision
from session.service import NegotiationSessionService


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SAMPLE_SKU: Dict[str, Any] = {
    "id": "sku-test-001",
    "sku_code": "TSH-PREM-001",
    "name": "Premium Cotton Tee",
    "base_price": 500.0,
    "inventory_qty": 240,
    "tags": ["bestseller"],
}

SAMPLE_POLICY: Dict[str, Any] = {
    "id": "pol-test-001",
    "sku_id": "sku-test-001",
    "sku_code": "TSH-PREM-001",
    "cost_price": 220.0,
    "floor_price": 260.0,
    "min_margin_pct": 15.0,
    "qty_tier_discounts": [
        {"min_qty": 1, "max_qty": 499, "discount_pct": 0},
        {"min_qty": 500, "max_qty": None, "discount_pct": 14},
    ],
    "inventory_age_days": 12,
    "urgency_flex_pct": 2.0,
    "max_total_discount_pct": 20.0,
    "auto_approve_threshold_pct": 15.0,
    "max_rounds": 5,
    "inventory_discretion": {"age_threshold_days": 90, "extra_discount_pct": 4.0},
}


class MockLLM:
    """Returns a counter-offer at ₹300, or accepts when buyer accepts."""

    def get_seller_response(self, system_prompt: str, user_prompt: str) -> NegotiationDecision:
        if "BUYER_ACCEPTS" in user_prompt or "accepted" in user_prompt.lower():
            return NegotiationDecision(
                counter_price=300.0,
                justification="Deal agreed at ₹300.",
                internal_reasoning="Buyer accepted seller offer.",
                should_accept=True,
                needs_approval=False,
            )
        return NegotiationDecision(
            counter_price=300.0,
            justification="Competitive pricing for bulk orders.",
            internal_reasoning="Testing counter at 300.",
            should_accept=False,
            needs_approval=False,
        )


def _make_test_app(scopes: List[str], client_name: str = "test-client") -> FastAPI:
    """Build a minimal FastAPI app with stubbed auth and InMemory repo."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(SAMPLE_SKU)
    repo.save_pricing_policy(SAMPLE_POLICY)
    service = NegotiationSessionService(repo=repo, llm_client=MockLLM())

    test_app = FastAPI()

    # Stub auth middleware — always succeeds with the given scopes
    auth_client = AuthenticatedClient(client_name=client_name, scopes=scopes)

    @test_app.middleware("http")
    async def inject_state(request: Request, call_next):
        if (
            request.url.path.startswith("/api/v1/checkout/")
            or request.url.path == "/api/v1/orders"
            or request.url.path == "/api/v1/payments/verify"
            or (request.url.path.startswith("/api/v1/sessions/") and request.url.path.endswith("/order"))
            or request.url.path == "/api/v1/health"
        ):
            request.state.auth_client = auth_client
            request.state.service = service
            return await call_next(request)

        raw_key = request.headers.get("X-API-Key")
        if not raw_key:
            return JSONResponse(status_code=401, content={"detail": "X-API-Key header missing"})
        request.state.auth_client = auth_client
        request.state.service = service
        return await call_next(request)

    test_app.include_router(router)
    return test_app


def _make_no_auth_app() -> FastAPI:
    """App whose middleware rejects all requests (simulates invalid key)."""
    test_app = FastAPI()

    @test_app.middleware("http")
    async def reject_all(request: Request, call_next):
        raw_key = request.headers.get("X-API-Key")
        if not raw_key:
            return JSONResponse(status_code=401, content={"detail": "X-API-Key header missing"})
        return JSONResponse(status_code=401, content={"detail": "Invalid or inactive API key"})

    test_app.include_router(router)
    return test_app


# ---------------------------------------------------------------------------
# Test: Missing API key → 401
# ---------------------------------------------------------------------------

def test_missing_api_key_returns_401() -> None:
    """Requests without X-API-Key header must get 401."""
    app = _make_no_auth_app()
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/sessions/some-id")
    assert resp.status_code == 401
    assert "missing" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Test: Invalid API key → 401
# ---------------------------------------------------------------------------

def test_invalid_api_key_returns_401() -> None:
    """Requests with a wrong API key must get 401."""
    app = _make_no_auth_app()
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/api/v1/sessions/some-id", headers={"X-API-Key": "garbage"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Test: Missing scope → 403
# ---------------------------------------------------------------------------

def test_missing_scope_returns_403() -> None:
    """A buyer-scoped key must not be able to hit the merchant-decision endpoint."""
    # Buyer has NO merchant:approve scope
    app = _make_test_app(scopes=["buyer:negotiate", "buyer:accept", "buyer:decline", "session:read"])
    client = TestClient(app, raise_server_exceptions=False)

    # First create a session with admin scope via separate app
    admin_app = _make_test_app(scopes=["admin:create_session", "session:read", "audit:read"])
    admin_client = TestClient(admin_app, raise_server_exceptions=False)
    create_resp = admin_client.post("/api/v1/sessions", json={
        "buyer_id": "test-buyer",
        "sku_code": "TSH-PREM-001",
        "quantity": 10,
    }, headers={"X-API-Key": "admin-key"})
    assert create_resp.status_code == 201
    session_id = create_resp.json()["session_id"]

    # Now try to approve as a buyer — should fail with 403
    resp = client.post(
        f"/api/v1/sessions/{session_id}/merchant-decision",
        json={"action": "approve"},
        headers={"X-API-Key": "buyer-key"},
    )
    assert resp.status_code == 403
    assert "merchant:approve" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# Test: Health check (no auth required)
# ---------------------------------------------------------------------------

def test_health_check_no_auth() -> None:
    """Health endpoint requires no API key."""
    app = _make_no_auth_app()
    # Health is at /api/v1/health — but our test middleware rejects all keyed requests.
    # Use a bare app with just the router and no middleware.
    bare_app = FastAPI()
    bare_app.include_router(router)
    client = TestClient(bare_app, raise_server_exceptions=False)
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert int(resp.json()["phase"]) >= 6


# ---------------------------------------------------------------------------
# Test: Full round-trip session create → buyer move
# ---------------------------------------------------------------------------

def test_create_session_and_buyer_move() -> None:
    """Create a session via API, submit a buyer move, verify negotiation response."""
    app = _make_test_app(scopes=[
        "admin:create_session", "session:read", "buyer:negotiate",
        "buyer:accept", "buyer:decline", "audit:read",
    ])
    client = TestClient(app, raise_server_exceptions=False)

    # 1. Create session
    create_resp = client.post("/api/v1/sessions", json={
        "buyer_id": "ai-buyer-001",
        "sku_code": "TSH-PREM-001",
        "quantity": 100,
        "channel": "API",
    }, headers={"X-API-Key": "any-key"})
    assert create_resp.status_code == 201, create_resp.text
    body = create_resp.json()
    assert body["status"] == "INITIATED"
    assert body["quantity"] == 100
    session_id = body["session_id"]

    # 2. Buyer move
    move_resp = client.post(f"/api/v1/sessions/{session_id}/moves", json={
        "quantity": 100,
        "offered_price": 350.0,
        "buyer_message": "Opening offer",
        "accept_last_offer": False,
    }, headers={"X-API-Key": "any-key"})
    assert move_resp.status_code == 200, move_resp.text
    move_body = move_resp.json()
    assert move_body["session_id"] == session_id
    assert move_body["status"] in ("IN_PROGRESS", "AGREED", "FINAL_OFFER", "PENDING_APPROVAL")

    # 3. GET session state
    get_resp = client.get(f"/api/v1/sessions/{session_id}", headers={"X-API-Key": "any-key"})
    assert get_resp.status_code == 200
    assert get_resp.json()["session_id"] == session_id

    # 4. Audit trail
    audit_resp = client.get(f"/api/v1/sessions/{session_id}/audit", headers={"X-API-Key": "any-key"})
    assert audit_resp.status_code == 200
    audit_body = audit_resp.json()
    assert audit_body["chain_valid"] is True
    assert len(audit_body["entries"]) >= 2  # SESSION_CREATED + at least one move


def test_buyer_move_on_agreed_session_returns_200_with_checkout_url() -> None:
    """Submitting moves or accepting on an already AGREED session returns 200 with checkout_url, never 500."""
    app = _make_test_app(scopes=[
        "admin:create_session", "session:read", "buyer:negotiate",
        "buyer:accept", "buyer:decline", "audit:read",
    ])
    client = TestClient(app, raise_server_exceptions=False)

    # 1. Create session
    create_resp = client.post("/api/v1/sessions", json={
        "buyer_id": "ai-buyer-agreed",
        "sku_code": "TSH-PREM-001",
        "quantity": 100,
        "channel": "API",
    }, headers={"X-API-Key": "any-key"})
    assert create_resp.status_code == 201
    session_id = create_resp.json()["session_id"]

    # 2. Negotiate to enter IN_PROGRESS
    move1 = client.post(f"/api/v1/sessions/{session_id}/moves", json={
        "quantity": 100,
        "offered_price": 300.0,
        "buyer_message": "Can you do 300?",
        "accept_last_offer": False,
    }, headers={"X-API-Key": "any-key"})
    assert move1.status_code == 200

    # 3. Accept seller offer to transition to AGREED
    accept_resp = client.post(f"/api/v1/sessions/{session_id}/accept", headers={"X-API-Key": "any-key"})
    assert accept_resp.status_code == 200
    accept_data = accept_resp.json()
    assert accept_data["status"] == "AGREED"
    assert accept_data["checkout_url"] == f"/api/v1/checkout/{session_id}"

    # 3. Subsequent buyer move on AGREED session must return 200 (NOT 500) with checkout_url
    subsequent_move_resp = client.post(f"/api/v1/sessions/{session_id}/moves", json={
        "quantity": 100,
        "offered_price": 280.0,
        "buyer_message": "Can I get even more discount?",
        "accept_last_offer": False,
    }, headers={"X-API-Key": "any-key"})
    assert subsequent_move_resp.status_code == 200
    sub_data = subsequent_move_resp.json()
    assert sub_data["status"] == "AGREED"
    assert sub_data["checkout_url"] == f"/api/v1/checkout/{session_id}"
    assert sub_data["final_agreed_price"] is not None

    # 4. Subsequent accept call on AGREED session must also return 200 with checkout_url
    second_accept_resp = client.post(f"/api/v1/sessions/{session_id}/accept", headers={"X-API-Key": "any-key"})
    assert second_accept_resp.status_code == 200
    second_accept_data = second_accept_resp.json()
    assert second_accept_data["status"] == "AGREED"
    assert second_accept_data["checkout_url"] == f"/api/v1/checkout/{session_id}"


def test_razorpay_order_creation_and_checkout_flow() -> None:
    """Full test of minimal frontend checkout and Razorpay fetch API integration."""
    app = _make_test_app(scopes=[
        "admin:create_session", "session:read", "buyer:negotiate",
        "buyer:accept", "audit:read",
    ])
    client = TestClient(app, raise_server_exceptions=False)

    # 1. Create session with quantity=100
    create_resp = client.post("/api/v1/sessions", json={
        "buyer_id": "buyer-rzp-01",
        "sku_code": "TSH-PREM-001",
        "quantity": 100,
        "channel": "API",
    }, headers={"X-API-Key": "any-key"})
    assert create_resp.status_code == 201
    session_id = create_resp.json()["session_id"]

    # 2. Negotiate and accept offer
    client.post(f"/api/v1/sessions/{session_id}/moves", json={
        "quantity": 100,
        "offered_price": 300.0,
        "accept_last_offer": False,
    }, headers={"X-API-Key": "any-key"})

    accept_resp = client.post(f"/api/v1/sessions/{session_id}/accept", headers={"X-API-Key": "any-key"})
    assert accept_resp.status_code == 200
    accept_data = accept_resp.json()
    assert accept_data["status"] == "AGREED"
    assert accept_data["amount"] == 30000.0
    assert accept_data["amount_paise"] == 3000000
    assert accept_data["currency"] == "INR"
    assert accept_data["checkout_url"] == f"/api/v1/checkout/{session_id}"

    # 3. GET /api/v1/checkout/{session_id} renders HTML page
    html_resp = client.get(f"/api/v1/checkout/{session_id}")
    assert html_resp.status_code == 200
    assert "text/html" in html_resp.headers["content-type"]
    assert "TSH-PREM-001" in html_resp.text
    assert "30,000.00" in html_resp.text or "30000.00" in html_resp.text
    assert "30,000.00 with Razorpay" in html_resp.text or "30000.00 with Razorpay" in html_resp.text
    assert "checkout.razorpay.com" in html_resp.text

    # 4. GET /api/v1/checkout/{session_id} on non-AGREED session returns 400
    create_init = client.post("/api/v1/sessions", json={
        "buyer_id": "buyer-init-01",
        "sku_code": "TSH-PREM-001",
        "quantity": 10,
        "channel": "API",
    }, headers={"X-API-Key": "any-key"})
    init_id = create_init.json()["session_id"]
    non_agreed_resp = client.get(f"/api/v1/checkout/{init_id}")
    assert non_agreed_resp.status_code == 400
    assert "AGREED" in non_agreed_resp.json()["detail"]


