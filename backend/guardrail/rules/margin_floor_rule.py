"""
MarginFloorRule — cost-margin protection.

Ensures the proposed price always covers cost_price plus the minimum
required margin percentage.  This prevents the agent from agreeing to a
deal that loses money even if the number happens to be above the floor price.

Example: cost_price = 220, margin_floor_pct = 15
  → min_acceptable = 220 × 1.15 = 253.  Any offer below 253 is clamped up.
"""

from guardrail.base import Offer, PricingRule, RuleResult
from models.pricing_policy import PricingPolicy


class MarginFloorRule(PricingRule):
    """Clamp the proposed price up to the minimum margin-protected price.

    The minimum acceptable price is derived deterministically from the hidden
    policy fields (cost_price, margin_floor_pct), so it is never exposed to
    the buyer or buyer agent.

    Rule logic:
      min_price = cost_price × (1 + margin_floor_pct / 100)

      - proposed_price <  min_price → clamp, passed=False, reason="below_margin_floor"
      - proposed_price >= min_price → pass through unchanged
    """

    def evaluate(self, offer: Offer, policy: PricingPolicy) -> RuleResult:
        min_price = policy.cost_price * (1.0 + policy.margin_floor_pct / 100.0)
        buyer_orig = getattr(offer, "original_proposed_price", None)
        orig_price = buyer_orig if buyer_orig is not None else offer.proposed_price

        if orig_price < min_price or offer.proposed_price < min_price:
            adjusted = max(offer.proposed_price, round(min_price, 2))
            return RuleResult(
                passed=False,
                rule_name="margin_floor",
                original_price=offer.proposed_price,
                adjusted_price=adjusted,
                reason="below_margin_floor",
            )

        return RuleResult(
            passed=True,
            rule_name="margin_floor",
            original_price=offer.proposed_price,
            adjusted_price=None,
            reason="ok",
        )