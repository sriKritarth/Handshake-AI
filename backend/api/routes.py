"""All API route definitions for the B2B Negotiation Agent API (Phase 6)."""
from __future__ import annotations

from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Request
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


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _session_record_to_response(record, sku_code: str = "") -> SessionResponse:
    """Convert a SessionRecord (domain object) into an HTTP SessionResponse."""
    return SessionResponse(
        session_id=record.id,
        status=record.status,
        current_round=record.current_round,
        quantity=record.quantity,
        sku_code=sku_code or record.sku_id,
        final_agreed_price=record.final_agreed_price,
        expires_at=record.expires_at.isoformat() if record.expires_at else None,
    )


def _domain_session_response_to_api(resp) -> NegotiationResponse:
    """Convert a domain SessionResponse into the HTTP NegotiationResponse."""
    return NegotiationResponse(
        session_id=resp.session_id,
        status=resp.status,
        round=str(resp.current_round),
        counter_price=resp.seller_proposed_price or resp.final_offer_price,
        justification=resp.draft_justification,
        message=resp.status_message,
        razorpay_short_url=resp.payment_link_url,
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

    return _session_record_to_response(record)


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

    return _domain_session_response_to_api(result)


@router.post("/sessions/{session_id}/accept", response_model=NegotiationResponse)
async def accept_offer(
    session_id: str,
    request: Request,
):
    """Buyer accepts the seller's last counter-offer. Requires scope: buyer:accept"""
    client: AuthenticatedClient = request.state.auth_client
    client.require_scope("buyer:accept")

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

    return _domain_session_response_to_api(result)


@router.post("/sessions/{session_id}/decline", response_model=NegotiationResponse)
async def decline_offer(
    session_id: str,
    request: Request,
):
    """Buyer walks away from the negotiation. Requires scope: buyer:decline"""
    client: AuthenticatedClient = request.state.auth_client
    client.require_scope("buyer:decline")

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
# Health check (no auth)
# ---------------------------------------------------------------------------

@router.get("/health")
async def health():
    return {"status": "ok", "phase": "6", "engine": "negotiation-agent-v1"}
