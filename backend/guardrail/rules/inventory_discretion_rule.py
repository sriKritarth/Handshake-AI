"""
InventoryDiscretionRule — aged-inventory extra discount headroom.

When a SKU has been sitting in stock beyond a configured age threshold, the
merchant allows the negotiation agent to go deeper than the normal floor price
to move the inventory.  This rule widens the lower bound from floor_price to
an extra-discounted floor — but only when the age condition is met.

Logic:
  IF policy.inventory_discretion is set
  AND policy.inventory_age_days >= age_threshold_days:
      extra_floor = floor_price × (1 − extra_discount_pct / 100)
      if proposed_price >= extra_floor → passed=True, reason="aged_inventory_discretion_ok"
      if proposed_price <  extra_floor → clamp to extra_floor, passed=False
  ELSE:
      The discretion is not triggered; rule passes through unchanged.

Example (JAC-LEATH-001): floor_price=4200, inventory_age_days=120
  age_threshold_days=90, extra_discount_pct=5
  → extra_floor = 4200 × 0.95 = 3990
  A proposed price of 4000 passes (≥ 3990).
  A proposed price of 3800 is clamped to 3990.
"""

from guardrail.base import Offer, PricingRule, RuleResult
from models.pricing_policy import PricingPolicy


class InventoryDiscretionRule(PricingRule):
    """Grant extra discount headroom for aged inventory when conditions are met.

    This rule only activates when:
      1. ``policy.inventory_discretion`` is not None, and
      2. ``policy.inventory_age_days >= policy.inventory_discretion.age_threshold_days``

    When inactive, the rule always returns passed=True with no adjustment,
    acting as a transparent no-op in the engine waterfall.
    """

    def evaluate(self, offer: Offer, policy: PricingPolicy) -> RuleResult:
        discretion = policy.inventory_discretion

        # Discretion not configured for this SKU — rule is a no-op
        if discretion is None:
            return RuleResult(
                passed=True,
                rule_name="inventory_discretion",
                original_price=offer.proposed_price,
                adjusted_price=None,
                reason="no_discretion_configured",
            )

        # Inventory not old enough to trigger discretion
        if policy.inventory_age_days < discretion.age_threshold_days:
            return RuleResult(
                passed=True,
                rule_name="inventory_discretion",
                original_price=offer.proposed_price,
                adjusted_price=None,
                reason="inventory_not_aged",
            )

        # Aged inventory — compute the extra-discounted floor
        extra_floor = round(
            policy.floor_price * (1.0 - discretion.extra_discount_pct / 100.0), 2
        )

        if offer.proposed_price < extra_floor:
            return RuleResult(
                passed=False,
                rule_name="inventory_discretion",
                original_price=offer.proposed_price,
                adjusted_price=extra_floor,
                reason="below_aged_inventory_floor",
            )

        return RuleResult(
            passed=True,
            rule_name="inventory_discretion",
            original_price=offer.proposed_price,
            adjusted_price=None,
            reason="aged_inventory_discretion_ok",
        )