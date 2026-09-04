"""Pydantic data models and schemas for the Negotiation Session layer."""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class SessionState(str, Enum):
    """Allowed states for negotiation sessions."""
    INITIATED = "INITIATED"
    IN_PROGRESS = "IN_PROGRESS"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    FINAL_OFFER = "FINAL_OFFER"
    AGREED = "AGREED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class NegotiationDecision(BaseModel):
    """Structured negotiation decision returned by Instructor / Groq LLM."""

    counter_price: float = Field(
        ...,
        description=(
            "Your counter-offer price per unit in INR. "
            "MUST be greater than or equal to the floor price. "
            "Round to clean whole rupee (e.g. 470 or 1380, no decimals). "
            "If should_accept is true, set this to the buyer's offered price. "
            "If needs_approval is true, set this to the buyer's offered price."
        ),
    )
    counter_quantity: Optional[int] = Field(
        default=None,
        description=(
            "Optional logrolling volume counter. When the buyer requests a steep discount below "
            "their current tier price, you may offer to meet their price IF they increase order volume "
            "to this quantity (helping clear inventory). Set to None if keeping the buyer's requested quantity."
        ),
    )
    justification: str = Field(
        ...,
        description=(
            "Persuasive commercial message the buyer will see explaining your counter-offer (2-3 sentences). "
            "Highlight product quality, volume batching, warranty, delivery reliability. "
            "If proposing a volume upsell, explain why the higher quantity unlocks the discount. "
            "NEVER mention internal policies, formulas, gap percentages, floor price, or margin floor."
        ),
    )
    internal_reasoning: str = Field(
        ...,
        description=(
            "Comprehensive strategic reasoning for merchant review and audit. Never shown to buyer. "
            "Detail: applicable volume tier, gross margin % preserved, carrying cost/stock clearance contribution, "
            "and tactical rationale for why this price/volume was chosen."
        ),
    )
    should_accept: bool = Field(
        ...,
        description=(
            "Set to true ONLY when: "
            "(1) the buyer's offered price is at or above the margin floor, OR "
            "(2) the buyer explicitly accepts your last counter-offer. "
            "In all other cases, set to false."
        ),
    )
    needs_approval: bool = Field(
        ...,
        description=(
            "Set to true ONLY when: "
            "the buyer's offered price is at or above the floor price "
            "AND below the margin floor. "
            "In all other cases, set to false."
        ),
    )


class BuyerMove(BaseModel):
    """Payload representing a buyer's move in a negotiation round."""

    quantity: int = Field(default=1, gt=0, description="Purchase quantity")
    offered_price: Optional[float] = Field(
        default=None, description="Buyer's offered unit price in INR"
    )
    buyer_message: Optional[str] = Field(
        default=None, max_length=500, description="Buyer's note or stated justification"
    )
    accept_last_offer: bool = Field(
        default=False, description="True if buyer explicitly accepts seller's previous counter-offer"
    )


class MerchantDecisionRequest(BaseModel):
    """Payload for merchant review of an escalated deal."""

    decision: str = Field(..., description="Decision: 'approve', 'reject', or 'counter'")
    counter_price: Optional[float] = Field(
        default=None, description="Counter price if decision is 'counter'"
    )
    merchant_notes: Optional[str] = Field(
        default=None, description="Optional explanation from merchant"
    )


class SessionResponse(BaseModel):
    """Public JSON response representing the current session status and counter-offer."""

    session_id: str
    sku_code: str
    status: str
    current_round: int
    max_rounds: int
    seller_proposed_price: Optional[float] = None
    counter_quantity: Optional[int] = None
    quantity: int = 1
    draft_justification: Optional[str] = None
    internal_reasoning: Optional[str] = None
    final_offer_price: Optional[float] = None
    final_agreed_price: Optional[float] = None
    pending_approval_price: Optional[float] = None
    expires_at: Optional[datetime] = None
    payment_link_url: Optional[str] = None
    checkout_url: Optional[str] = None
    razorpay_order_id: Optional[str] = None
    status_message: str
