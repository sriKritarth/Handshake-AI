"""
QuantityTierRule — volume discount tier enforcement.

Determines the maximum discount the agent is allowed to grant based on the
buyer's requested quantity.  The rule does not block; it sets the approved
tier price as adjusted_price (the lowest price the agent may offer for this
quantity), so downstream rules can compare against it.

Tier matching logic:
  - Iterate policy.quantity_tiers in order.
  - A tier matches when min_qty <= quantity and (max_qty is None or quantity <= max_qty).
  - The highest matching tier wins (tiers are expected to be ordered ascending
    by min_qty in the YAML; we find the last one that still matches).
  - If no tier matches (shouldn't happen with well-authored data), treat as 0% discount.

Example (from pricing_policy.yaml for TSH-PREM-001):
  Tiers: [1–49: 0%], [50–199: 6%], [200–499: 10%], [500+: 14%]
  quantity=75, list_price=499
  → matches tier 50–199 → tier_price = 499 × (1 - 0.06) = 469.06
"""

from guardrail.base import Offer, PricingRule, RuleResult
from models.pricing_policy import PricingPolicy, QuantityTier


def _find_best_tier(quantity: int, tiers: list[QuantityTier]) -> QuantityTier | None:
    """Return the highest applicable tier for the given quantity, or None."""
    best: QuantityTier | None = None
    for tier in tiers:
        if (quantity >= tier.min_qty) and (quantity <= tier.max_qty or tier.max_qty is None): 
            # This tier matches; keep it (last matching = highest applicable)
            best = tier
    return best


class QuantityTierRule(PricingRule):
    """Enforce volume discount tiers from the pricing policy.

    This rule is non-blocking: it always returns passed=True but sets
    adjusted_price to the tier-approved price when the proposed_price is
    *above* what the tier would allow (i.e. the buyer proposed less than
    the tier floor — which is fine, later rules will catch it).

    The primary purpose is to *record* the tier-approved price so the engine
    has it for the final offer construction.  If the buyer's proposed price is
    already at or below the tier price, the rule passes and doesn't adjust.
    """

    def evaluate(self, offer: Offer, policy: PricingPolicy) -> RuleResult:
        tier = _find_best_tier(offer.quantity, policy.quantity_tiers)

        if tier is None:
            # No tiers defined — no discount authorised
            return RuleResult(
                passed=True,
                rule_name="quantity_tier",
                original_price=offer.proposed_price,
                adjusted_price=None,
                reason="no_tier_defined",
            )

        tier_price = round(offer.list_price * (1.0 - tier.discount_pct / 100.0), 2)

        # If the buyer proposed ABOVE the tier price, agent should counter at tier_price.
        # If the buyer proposed AT or BELOW, the tier is already met (good for buyer).
        if offer.proposed_price > tier_price:
            return RuleResult(
                passed=True,
                rule_name="quantity_tier",
                original_price=offer.proposed_price,
                adjusted_price=tier_price,
                reason=f"tier_discount_{tier.discount_pct}pct_applied",
            )

        return RuleResult(
            passed=True,
            rule_name="quantity_tier",
            original_price=offer.proposed_price,
            adjusted_price=None,
            reason=f"within_tier_{tier.discount_pct}pct",
        )