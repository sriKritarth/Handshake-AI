"""All API route definitions for the B2B Negotiation Agent API (Phase 7)."""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from api.auth import AuthenticatedClient, api_key_header
from api.schemas import (
    AuditLogResponse,
    BuyerMoveRequest,
    CreateSessionRequest,
    MerchantDecisionRequest,
    NegotiationResponse,
    SessionResponse,
)

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/api/v1", tags=["negotiation"], dependencies=[Depends(api_key_header)])

log = structlog.get_logger()


# ---------------------------------------------------------------------------
# Phase 7 response schemas
# ---------------------------------------------------------------------------

class ReplayEntry(BaseModel):
    """A single chronological event in the replay timeline."""
    index: int
    event_type: str
    from_state: Optional[str]
    to_state: Optional[str]
    actor: Optional[str]
    price: Optional[float]
    logged_at: str
    details: Optional[Dict[str, Any]] = None


class ReplayResponse(BaseModel):
    session_id: str
    total_events: int
    timeline: List[ReplayEntry]


class VerifyEntry(BaseModel):
    index: int
    event_type: str
    logged_at: str
    expected_hash: str
    recorded_hash: str
    valid: bool


class VerifyResponse(BaseModel):
    session_id: str
    chain_valid: bool
    total_entries: int
    entries: List[VerifyEntry]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _session_record_to_response(record, sku_code: str = "", offer_events: Optional[list] = None) -> SessionResponse:
    """Convert a SessionRecord (domain object) into an HTTP SessionResponse.

    Populates latest_seller_price and latest_buyer_price by scanning the
    offer_events list (most-recent-first) so the buyer agent always receives
    the freshest merchant/seller counter when polling after PENDING_APPROVAL.
    """
    latest_seller: Optional[float] = None
    latest_buyer: Optional[float] = None

    if offer_events:
        for ev in reversed(offer_events):
            sender = str(ev.get("sender", "")).upper()
            price = ev.get("proposed_price") or ev.get("guardrail_clamped_price")
            if latest_seller is None and sender in ("SELLER_AI", "SELLER_GUARDRAIL", "MERCHANT"):
                latest_seller = float(price) if price is not None else None
            if latest_buyer is None and sender == "BUYER":
                latest_buyer = float(price) if price is not None else None
            if latest_seller is not None and latest_buyer is not None:
                break

    checkout_url = f"/api/v1/checkout/{record.id}" if record.status == "AGREED" else None
    #check this
    return SessionResponse(
        session_id=record.id,
        status=record.status,
        current_round=record.current_round,
        quantity=record.quantity or None,
        sku_code=sku_code or record.sku_id,
        latest_seller_price=latest_seller,
        latest_buyer_price=latest_buyer,
        final_agreed_price=record.final_agreed_price,
        checkout_url=checkout_url,
        expires_at=record.expires_at.isoformat() if record.expires_at else None,
    )


def _domain_session_response_to_api(resp) -> NegotiationResponse:
    """Convert a domain SessionResponse into the HTTP NegotiationResponse."""
    return NegotiationResponse(
        session_id=resp.session_id,
        status=resp.status,
        round=str(resp.current_round),
        counter_price=resp.seller_proposed_price or resp.final_offer_price,
        counter_quantity=resp.counter_quantity,
        justification=resp.draft_justification,
        seller_justification=resp.internal_reasoning,
        message=resp.status_message,
        razorpay_short_url=resp.payment_link_url,
        checkout_url=resp.checkout_url,
        final_agreed_price=resp.final_agreed_price,
    )


# ---------------------------------------------------------------------------
# Session lifecycle
# ---------------------------------------------------------------------------

@router.post("/sessions", response_model=SessionResponse, status_code=201)
async def create_session(
    req: CreateSessionRequest,
    request: Request,
):
    """Create a new negotiation session. Requires scope: admin:create_session"""
    client: AuthenticatedClient = request.state.auth_client
    client.require_scope("admin:create_session")

    log.info(
        "session_create_request",
        buyer_id=req.buyer_id,
        sku_code=req.sku_code,
        channel=req.channel,
    )
    service = request.state.service
    try:
        record = service.create_session(
            buyer_id=req.buyer_id,
            sku_code=req.sku_code,
            channel=req.channel,
            quantity=req.quantity,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    log.info("session_created", session_id=record.id, status=record.status)
    return _session_record_to_response(record, sku_code=req.sku_code)


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: str,
    request: Request,
):
    """Get current session state. Triggers lazy expiry checks. Requires scope: session:read"""
    client: AuthenticatedClient = request.state.auth_client
    client.require_scope("session:read")

    service = request.state.service
    try:
        record = service.get_session(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Session not found")

    # Fetch offer events so latest_seller_price / latest_buyer_price are populated.
    # This is the critical field the buyer agent reads after a merchant counter.
    offer_events = service.repo.get_offer_events(session_id)
    return _session_record_to_response(record, offer_events=offer_events)


# ---------------------------------------------------------------------------
# Buyer agent endpoints
# ---------------------------------------------------------------------------

@router.post("/sessions/{session_id}/moves", response_model=NegotiationResponse)
@limiter.limit("10/minute")
async def buyer_move(
    session_id: str,
    req: BuyerMoveRequest,
    request: Request,
):
    """Submit a buyer offer or counter. Returns seller response. Requires scope: buyer:negotiate"""
    client: AuthenticatedClient = request.state.auth_client
    client.require_scope("buyer:negotiate")

    log.info(
        "buyer_move_request",
        session_id=session_id,
        offered_price=req.offered_price,
        quantity=req.quantity,
    )
    service = request.state.service
    from session.models import BuyerMove

    move = BuyerMove(
        quantity=req.quantity,
        offered_price=req.offered_price,
        buyer_message=req.buyer_message,
        accept_last_offer=req.accept_last_offer,
    )
    try:
        result = service.handle_buyer_move(session_id, move)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    log.info(
        "buyer_move_response",
        session_id=session_id,
        status=result.status,
        counter_price=result.seller_proposed_price,
    )
    return _domain_session_response_to_api(result)


@router.post("/sessions/{session_id}/accept", response_model=NegotiationResponse)
async def accept_offer(
    session_id: str,
    request: Request,
):
    """Buyer accepts the seller's last counter-offer. Requires scope: buyer:accept"""
    client: AuthenticatedClient = request.state.auth_client
    client.require_scope("buyer:accept")

    log.info("buyer_accept_request", session_id=session_id)
    service = request.state.service
    from session.models import BuyerMove

    # Accept is expressed as a buyer move with accept_last_offer=True
    try:
        session = service.get_session(session_id)
        move = BuyerMove(
            quantity=session.quantity,
            offered_price=None,
            accept_last_offer=True,
        )
        result = service.handle_buyer_move(session_id, move)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    log.info(
        "buyer_accept_response",
        session_id=session_id,
        status=result.status,
        final_price=result.final_agreed_price,
    )
    return _domain_session_response_to_api(result)


@router.post("/sessions/{session_id}/decline", response_model=NegotiationResponse)
async def decline_offer(
    session_id: str,
    request: Request,
):
    """Buyer walks away from the negotiation. Requires scope: buyer:decline"""
    client: AuthenticatedClient = request.state.auth_client
    client.require_scope("buyer:decline")

    log.info("buyer_decline_request", session_id=session_id)
    service = request.state.service
    try:
        from session.fsm import InvalidStateTransitionError, NegotiationFSM

        session = service.get_session(session_id)
        fsm = NegotiationFSM(session)
        fsm.reject()
        service.repo.update_session(session)
        service._append_audit(
            session_id=session_id,
            event_type="BUYER_DECLINED",
            from_state="IN_PROGRESS",
            to_state="REJECTED",
            actor=client.client_name,
            details={"reason": "Buyer voluntarily declined the negotiation"},
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    log.info("buyer_declined", session_id=session_id, status="REJECTED")
    return NegotiationResponse(
        session_id=session_id,
        status="REJECTED",
        message="Negotiation declined by buyer.",
    )


# ---------------------------------------------------------------------------
# Merchant endpoints
# ---------------------------------------------------------------------------

@router.post("/sessions/{session_id}/merchant-decision", response_model=NegotiationResponse)
async def merchant_decision(
    session_id: str,
    req: MerchantDecisionRequest,
    request: Request,
):
    """Merchant approves, rejects, or counter-offers a pending approval.
    Requires one of: merchant:approve | merchant:reject | merchant:counter"""
    client: AuthenticatedClient = request.state.auth_client
    # Check scope after body is parsed (req.action is available here)
    client.require_scope(f"merchant:{req.action}")

    log.info(
        "merchant_decision_request",
        session_id=session_id,
        action=req.action,
        counter_price=req.counter_price,
    )
    service = request.state.service

    # Map HTTP schema → domain model
    from session.models import MerchantDecisionRequest as DomainMDR

    domain_req = DomainMDR(
        decision=req.action,
        counter_price=req.counter_price,
        merchant_notes=req.merchant_notes,
    )
    try:
        result = service.handle_merchant_decision(session_id, domain_req)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    log.info("merchant_decision_response", session_id=session_id, status=result.status)
    return _domain_session_response_to_api(result)


# ---------------------------------------------------------------------------
# Audit endpoint
# ---------------------------------------------------------------------------

@router.get("/sessions/{session_id}/audit", response_model=AuditLogResponse)
async def get_audit_trail(
    session_id: str,
    request: Request,
):
    """Get the full tamper-evident audit trail for a session. Requires scope: audit:read"""
    client: AuthenticatedClient = request.state.auth_client
    client.require_scope("audit:read")

    service = request.state.service
    logs = service.repo.get_audit_logs(session_id)
    chain_valid = _verify_chain(logs)
    return AuditLogResponse(entries=logs, chain_valid=chain_valid)


def _verify_chain(logs: list) -> bool:
    """Verify SHA-256 hash chain integrity of audit log entries."""
    from session.audit import AuditService

    for i, entry in enumerate(logs):
        expected_prev = logs[i - 1]["current_hash"] if i > 0 else "GENESIS"
        recalc = AuditService.calculate_hash(
            previous_hash=expected_prev,
            session_id=entry["session_id"],
            event_id=entry.get("event_id"),
            snapshot_data=entry["snapshot_data"],
            logged_at=entry["logged_at"],
        )
        if recalc != entry["current_hash"]:
            return False
    return True


# ---------------------------------------------------------------------------
# Phase 7: Replay & Verify endpoints
# ---------------------------------------------------------------------------

@router.get("/sessions/{session_id}/replay", response_model=ReplayResponse)
async def replay_session(
    session_id: str,
    request: Request,
):
    """Return the full chronological negotiation timeline for a session.
    Each entry surfaces event type, state transition, actor, and price.
    Useful for judges to re-read the negotiation story end-to-end.
    Requires scope: audit:read
    """
    client: AuthenticatedClient = request.state.auth_client
    client.require_scope("audit:read")

    log.info("replay_requested", session_id=session_id)

    service = request.state.service
    logs = service.repo.get_audit_logs(session_id)

    timeline: List[ReplayEntry] = []
    for idx, entry in enumerate(logs):
        snap = entry.get("snapshot_data", {})
        # Extract price from common detail keys — works across all event types
        price = (
            snap.get("proposed_price")
            or snap.get("counter_price")
            or snap.get("final_agreed_price")
        )
        timeline.append(ReplayEntry(
            index=idx + 1,
            event_type=snap.get("event_type", entry.get("event_id", "UNKNOWN")),
            from_state=snap.get("from_state"),
            to_state=snap.get("to_state"),
            actor=snap.get("actor"),
            price=float(price) if price is not None else None,
            logged_at=entry["logged_at"],
            details={k: v for k, v in snap.items()
                     if k not in ("event_type", "from_state", "to_state", "actor")},
        ))

    return ReplayResponse(
        session_id=session_id,
        total_events=len(timeline),
        timeline=timeline,
    )


@router.get("/sessions/{session_id}/verify", response_model=VerifyResponse)
async def verify_session(
    session_id: str,
    request: Request,
):
    """Per-entry hash-chain validation for every audit log entry in a session.
    Returns each entry's recorded hash vs recalculated hash so judges can see
    cryptographic proof that the negotiation trail was not tampered with.
    Requires scope: audit:read
    """
    client: AuthenticatedClient = request.state.auth_client
    client.require_scope("audit:read")

    log.info("verify_requested", session_id=session_id)

    service = request.state.service
    from session.audit import AuditService

    logs = service.repo.get_audit_logs(session_id)
    entries: List[VerifyEntry] = []
    chain_valid = True

    for i, entry in enumerate(logs):
        expected_prev = logs[i - 1]["current_hash"] if i > 0 else "GENESIS"
        recalc = AuditService.calculate_hash(
            previous_hash=expected_prev,
            session_id=entry["session_id"],
            event_id=entry.get("event_id"),
            snapshot_data=entry["snapshot_data"],
            logged_at=entry["logged_at"],
        )
        valid = recalc == entry["current_hash"]
        if not valid:
            chain_valid = False

        snap = entry.get("snapshot_data", {})
        entries.append(VerifyEntry(
            index=i + 1,
            event_type=snap.get("event_type", "UNKNOWN"),
            logged_at=entry["logged_at"],
            expected_hash=recalc,
            recorded_hash=entry["current_hash"],
            valid=valid,
        ))

    return VerifyResponse(
        session_id=session_id,
        chain_valid=chain_valid,
        total_entries=len(entries),
        entries=entries,
    )


# ---------------------------------------------------------------------------
# Health check (no auth)
# ---------------------------------------------------------------------------

@router.get("/health")
async def health():
    return {"status": "ok", "phase": "7", "engine": "negotiation-agent-v1"}
