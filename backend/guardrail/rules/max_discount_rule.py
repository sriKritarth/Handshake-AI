"""
MaxDiscountRule — total discount cap + merchant-approval gating.

Per the briefing:
  "Gated: discounts beyond a configured threshold require merchant approval
   before a payment link is created."

This rule enforces two thresholds:
  1. Hard cap:  discount_pct > policy.max_total_discount_pct
                → clamp price, passed=False, requires_merchant_approval=True
  2. Soft gate: discount_pct > auto_approve_threshold (constructor arg, default
                80% of max_total_discount_pct)
                → price is technically legal, but flag for merchant approval

Discount is computed against the buyer's list_price (public reference price):
  discount_pct = (list_price − proposed_price) / list_price × 100

Constructor:
    auto_approve_threshold_pct (float | None):
        If None, defaults to 80% of policy.max_total_discount_pct at eval time.
        If set explicitly (e.g. 15.0), that value is used regardless of policy.
"""

from guardrail.base import Offer, PricingRule, RuleResult
from models.pricing_policy import PricingPolicy


class MaxDiscountRule(PricingRule):
    """Enforce the absolute maximum discount cap and flag merchant-approval zone.

    Two-tier enforcement:
      - Hard cap  (discount > max_total_discount_pct):
            clamp proposed_price up to the floor implied by max_total_discount_pct,
            passed=False, requires_merchant_approval=True.
      - Soft gate (auto_approve_threshold < discount <= max_total_discount_pct):
            price is allowed, passed=True, requires_merchant_approval=True.
      - Normal zone (discount <= auto_approve_threshold):
            passed=True, requires_merchant_approval=False.
    """

    def __init__(self, auto_approve_threshold_pct: float | None = None) -> None:
        """
        Args:
            auto_approve_threshold_pct:
                Fixed percentage below which discounts are auto-approved.
                If None (default), uses 80% of policy.max_total_discount_pct
                at evaluation time.
        """
        self._auto_approve_threshold_pct = auto_approve_threshold_pct

    def evaluate(self, offer: Offer, policy: PricingPolicy) -> RuleResult:
        list_price = offer.list_price

        # Guard against zero/negative list_price (should be caught by Pydantic, but be safe)
        if list_price <= 0:
            return RuleResult(
                passed=False,
                rule_name="max_discount",
                original_price=offer.proposed_price,
                adjusted_price=None,
                reason="invalid_list_price",
            )

        discount_pct = (list_price - offer.proposed_price) / list_price * 100.0

        max_pct = policy.max_total_discount_pct
        auto_threshold = (
            self._auto_approve_threshold_pct
            if self._auto_approve_threshold_pct is not None
            else max_pct * 0.80
        )

        # --- Hard cap: above max allowed discount ---
        if discount_pct > max_pct:
            # Clamp price to the maximum permissible discount
            clamped_price = round(list_price * (1.0 - max_pct / 100.0), 2)
            return RuleResult(
                passed=False,
                rule_name="max_discount",
                original_price=offer.proposed_price,
                adjusted_price=clamped_price,
                reason="max_discount_exceeded",
                requires_merchant_approval=True,
            )

        # --- Soft gate: in merchant-approval zone ---
        if discount_pct > auto_threshold:
            return RuleResult(
                passed=True,
                rule_name="max_discount",
                original_price=offer.proposed_price,
                adjusted_price=None,
                reason="merchant_approval_required",
                requires_merchant_approval=True,
            )

        # --- Normal zone: auto-approved ---
        return RuleResult(
            passed=True,
            rule_name="max_discount",
            original_price=offer.proposed_price,
            adjusted_price=None,
            reason="ok",
            requires_merchant_approval=False,
        )