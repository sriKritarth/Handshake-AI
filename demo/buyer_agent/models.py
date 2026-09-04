"""Pydantic model for the buyer agent's structured LLM output."""
from __future__ import annotations

from pydantic import BaseModel, Field


class BuyerDecision(BaseModel):
    """Structured output from the buyer negotiation agent."""

    offer_price: float = Field(
        description=(
            "Your next offer price per unit in INR. "
            "Must be <= your walk_away_price. "
            "If should_accept is true, set this to the seller's last counter price."
        )
    )

    offer_quantity: int = Field(
        default=1,
        description=(
            "Number of units being proposed in this offer. "
            "Defaults to your desired base quantity. "
            "If counter-negotiating seller's volume upsell to fit within your budget cap, "
            "set this to an affordable batch size."
        ),
    )

    total_outlay: float = Field(
        default=0.0,
        description=(
            "Total order price in INR (offer_price * offer_quantity). "
            "Must never exceed your max_budget cap."
        ),
    )

    message: str = Field(
        description=(
            "1-2 short sentences to send to the seller (STRICT MAX 200 characters). "
            "Reference unit price, quantity/batch size, total budget constraints, or market rates. "
            "Be direct and strategic, not chatty. No greetings."
        )
    )

    internal_reasoning: str = Field(
        description=(
            "Private financial reasoning. Detail: unit price vs target, total order outlay vs max budget, "
            "quantity trade-offs (cash flow & inventory burden vs volume discount), and tactical plan."
        )
    )

    should_accept: bool = Field(
        description=(
            "True ONLY IF ALL THREE CONDITIONS HOLD: "
            "1) Seller's unit price is <= your walk_away_price (and ideally near target_price); "
            "2) Seller's total order outlay (price * quantity) is <= your max_budget cap; "
            "3) Seller's proposed quantity is <= your max_quantity absorption limit. "
            "If the seller proposes a low unit rate but demands an inflated quantity that makes "
            "total outlay exceed your budget, should_accept MUST BE FALSE."
        )
    )

    should_walk_away: bool = Field(
        description=(
            "True ONLY if the seller is not moving, you've used most of your rounds, "
            "and the seller's price or total budget requirement is untenable. "
            "Walking away ends the negotiation with no deal."
        )
    )
