"""Pydantic model for the buyer agent's structured LLM output."""
from __future__ import annotations

from pydantic import BaseModel, Field


class BuyerDecision(BaseModel):
    """Structured output from the buyer negotiation agent."""

    offer_price: float = Field(
        description=(
            "Your next offer price per unit in INR. "
            "Must be >= your walk_away_price. "
            "If should_accept is true, set this to the seller's last counter price."
        )
    )

    message: str = Field(
        description=(
            "1-2 short sentences to send to the seller (STRICT MAX 200 characters). "
            "Reference ONE of: market rates, competitor pricing, volume, or urgency. "
            "Be direct and strategic, not chatty. No greetings."
        )
    )

    internal_reasoning: str = Field(
        description=(
            "Private reasoning. Explain: how far the seller is from your target, "
            "how much you conceded this round, whether you think the seller is close "
            "to their floor, and your plan for remaining rounds."
        )
    )

    should_accept: bool = Field(
        description=(
            "True if the seller's last counter price is at or below your target_price. "
            "Also true if you judge the seller won't go lower and their price is "
            "still below your walk_away_price. False otherwise."
        )
    )

    should_walk_away: bool = Field(
        description=(
            "True ONLY if the seller is not moving, you've used most of your rounds, "
            "and the seller's price is still above your walk_away_price. "
            "Walking away ends the negotiation with no deal."
        )
    )
