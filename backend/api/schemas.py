"""HTTP request/response schemas for the negotiation API (Phase 6).

These are intentionally separate from the domain models in session/models.py.
Domain models carry internal business logic; these carry only what crosses the
HTTP boundary.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------

class CreateSessionRequest(BaseModel):
    buyer_id: str = Field(description="Unique identifier for the buyer / buyer agent")
    sku_code: str = Field(description="Catalog SKU code to negotiate on")
    quantity: int = Field(ge=1, description="Number of units being negotiated")
    channel: str = Field(default="CHAT", description="Communication channel")


class BuyerMoveRequest(BaseModel):
    quantity: int = Field(ge=1, description="Units the buyer wants")
    offered_price: float = Field(gt=0, description="Buyer's proposed unit price (₹)")
    buyer_message: Optional[str] = Field(
        None, max_length=500, description="Optional free-text message from buyer"
    )
    accept_last_offer: bool = Field(
        default=False, description="If True, buyer accepts the seller's last counter"
    )


class MerchantDecisionRequest(BaseModel):
    action: str = Field(description="One of: approve | reject | counter")
    counter_price: Optional[float] = Field(
        None, gt=0, description="Required when action=counter"
    )
    merchant_notes: Optional[str] = Field(None, max_length=500)


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------

class OfferEventResponse(BaseModel):
    round_number: int
    sender: str
    proposed_price: float
    clamped_price: Optional[float] = None
    justification: Optional[str] = None
    timestamp: str


class SessionResponse(BaseModel):
    session_id: str
    status: str
    current_round: int
    quantity: int
    sku_code: str
    latest_seller_price: Optional[float] = None
    latest_buyer_price: Optional[float] = None
    final_agreed_price: Optional[float] = None
    razorpay_short_url: Optional[str] = None
    expires_at: Optional[str] = None
    message: Optional[str] = None

    model_config = {"from_attributes": True}


class NegotiationResponse(BaseModel):
    session_id: str
    status: str
    round: Optional[str] = None
    counter_price: Optional[float] = None
    justification: Optional[str] = None
    message: Optional[str] = None
    razorpay_short_url: Optional[str] = None
    final_agreed_price: Optional[float] = None

    model_config = {"from_attributes": True}


class AuditLogResponse(BaseModel):
    entries: List[Dict[str, Any]]
    chain_valid: bool
