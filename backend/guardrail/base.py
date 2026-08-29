"""
Base types for the Guardrail Engine.

Offer        — the buyer's current proposal, passed through every rule.
RuleResult   — what a single PricingRule returns: passed/failed, optional price clamp,
               reason enum string, and whether merchant approval is needed.
PricingRule  — abstract base class every rule subclass must implement.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Literal, Optional

from pydantic import BaseModel, Field

from models.pricing_policy import PricingPolicy


# ---------------------------------------------------------------------------
# Offer — buyer-facing proposal data
# ---------------------------------------------------------------------------

class Offer(BaseModel):
    """A single negotiation proposal from the buyer (or buyer agent)."""

    sku: str = Field(..., description="Unique SKU identifier")
    proposed_price: float = Field(..., gt=0, description="Proposed unit price in INR")
    list_price: float = Field(
        ..., gt=0,
        description=(
            "Public list price in INR — used as the discount reference baseline. "
            "This is buyer-visible data, not a policy secret."
        ),
    )
    quantity: int = Field(..., gt=0, description="Number of units requested")
    round_number: int = Field(
        default=0, ge=0,
        description="Current negotiation round (0-indexed). Engine rejects offers once max_rounds is reached.",
    )
    urgency: Literal["high", "normal"] = Field(
        default="normal",
        description="Urgency flag — 'high' allows the agent to apply urgency_flex_pct.",
    )
    bundle_skus: list[str] = Field(
        default_factory=list,
        description="Other SKUs purchased together (enables bundle pricing logic).",
    )


# ---------------------------------------------------------------------------
# RuleResult — value object returned by every PricingRule
# ---------------------------------------------------------------------------

@dataclass
class RuleResult:
    """Immutable result returned by a single PricingRule evaluation.

    Attributes:
        passed              True when the offer satisfies this rule as-is.
        rule_name           Machine-readable rule identifier (e.g. "floor_price").
        original_price      The proposed_price the rule received as input.
        adjusted_price      The clamped/corrected price if the rule modified it; None if no change.
        reason              Short enum-style reason string for deterministic rationale templating.
        requires_merchant_approval
                            True when this rule flags the offer for escalation (e.g. discount exceeds
                            the auto-approve threshold). The engine surfaces this to the caller.
    """

    passed: bool
    rule_name: str
    original_price: float
    adjusted_price: Optional[float]   # None means "no change needed"
    reason: str
    requires_merchant_approval: bool = False

    @property
    def effective_price(self) -> float:
        """The price to use downstream — adjusted if clamped, original otherwise."""
        return self.adjusted_price if self.adjusted_price is not None else self.original_price


# ---------------------------------------------------------------------------
# PricingRule — abstract base for all rule subclasses
# ---------------------------------------------------------------------------

class PricingRule(ABC):
    """Abstract base class for every guardrail rule.

    Subclasses implement a single `.evaluate()` method.  The GuardrailEngine
    composes a list of these and runs them in order, feeding the effective price
    from each result into the next rule.
    """

    @abstractmethod
    def evaluate(self, offer: Offer, policy: PricingPolicy) -> RuleResult:
        """Evaluate the offer against this rule.

        Args:
            offer:  The current buyer proposal.  ``offer.proposed_price`` is the
                    price as adjusted by all preceding rules in the waterfall.
            policy: The *hidden* pricing policy for the offer's SKU — only the
                    GuardrailEngine (via PricingPolicyStore) ever reads this.

        Returns:
            A ``RuleResult``.  If the rule wants to clamp the price it sets
            ``adjusted_price``; the engine uses ``result.effective_price`` as the
            input to the next rule.
        """