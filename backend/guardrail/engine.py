"""
GuardrailEngine — composes all PricingRule subclasses into a single evaluation waterfall.

Architecture (from briefing):
  "The Guardrail Engine is a GuardrailEngine class composing a list of PricingRule
   subclasses, each implementing .evaluate(offer, policy) -> RuleResult."

Waterfall behaviour:
  Rules run in order.  After each rule, the effective_price (adjusted or original)
  becomes the proposed_price for the next rule.  This means:
    - FloorPriceRule clamps first → MarginFloorRule sees the clamped value → etc.
    - If a rule clamps the price, subsequent rules see the safer value.

GuardrailResult (returned to callers):
  - final_price:                 The price after all rules have run.
  - passed:                      True only if every rule passed without clamping.
  - requires_merchant_approval:  True if any rule flagged for escalation.
  - blocking_rule:               Name of the FIRST rule that set passed=False (or None).
                                 Use this for audit/logging ("who fired first").
  - deciding_rule:               Name of the LAST rule that actually changed the price
                                 (i.e. whose adjusted_price became final_price). Use this
                                 for rationale templating — it's the rule whose number you
                                 are quoting to the buyer.
  - rule_results:                Full ordered list of RuleResult for the audit log.
  - is_round_limit_final:        True when RoundLimitRule flagged round_limit_reached —
                                 caller should package this as the final take-it-or-leave-it offer.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import structlog
from guardrail.base import Offer, PricingRule, RuleResult
from guardrail.rules.floor_price_rule import FloorPriceRule
from guardrail.rules.inventory_discretion_rule import InventoryDiscretionRule
from guardrail.rules.margin_floor_rule import MarginFloorRule
from guardrail.rules.max_discount_rule import MaxDiscountRule
from guardrail.rules.quantity_tier_rule import QuantityTierRule
from guardrail.rules.round_limit_rule import RoundLimitRule
from models.pricing_policy import PricingPolicy

log = structlog.get_logger()


# ---------------------------------------------------------------------------
# GuardrailResult — aggregate result of the full rule waterfall
# ---------------------------------------------------------------------------

@dataclass
class GuardrailResult:
    """The output of a complete GuardrailEngine evaluation.

    Attributes:
        final_price:               Price after all rules have run (fully clamped/adjusted).
        passed:                    True only if no rule needed to clamp the price.
        requires_merchant_approval True if any rule flagged the offer for escalation.
        blocking_rule:             Name of the FIRST rule that set passed=False, or None.
                                   Audit field — tells you which rule fired first.
        deciding_rule:             Name of the LAST rule that changed the price (i.e. whose
                                   adjusted_price == final_price). Rationale field — this is
                                   the rule whose number you quote to the buyer. None if no
                                   rule needed to adjust the price (clean pass-through).
        rule_results:              Full ordered list of every rule's RuleResult (for audit).
        is_round_limit_final:      True when the session has reached max_rounds — the caller
                                   should present final_price as a take-it-or-leave-it offer.
    """

    final_price: float
    passed: bool
    requires_merchant_approval: bool
    blocking_rule: str | None
    deciding_rule: str | None
    rule_results: list[RuleResult] = field(default_factory=list)
    is_round_limit_final: bool = False


# ---------------------------------------------------------------------------
# GuardrailEngine
# ---------------------------------------------------------------------------

class GuardrailEngine:
    """Runs an ordered list of PricingRule subclasses in a price-waterfall.

    Usage::

        engine = GuardrailEngine.default(max_rounds=5)
        result = engine.evaluate(offer, policy)
        if result.is_round_limit_final:
            # package result.final_price as expiring take-it-or-leave-it
        elif result.requires_merchant_approval:
            # escalate to merchant approval flow
        else:
            # proceed with result.final_price
    """

    def __init__(self, rules: list[PricingRule]) -> None:
        """
        Args:
            rules: Ordered list of PricingRule instances.  Rules run left-to-right;
                   each rule receives the effective_price from the previous rule.
        """
        self._rules = rules

    # ------------------------------------------------------------------
    # Factory
    # ------------------------------------------------------------------

    @classmethod
    def default(
        cls,
        max_rounds: int = 5,
        auto_approve_threshold_pct: float | None = None,
    ) -> "GuardrailEngine":
        """Build a pre-configured engine with all six rules in the canonical order.

        Rule order rationale:
          1. RoundLimitRule   — short-circuit immediately if session is expired.
          2. FloorPriceRule   — hard absolute floor (jailbreak protection).
          3. MarginFloorRule  — cost-margin protection.
          4. InventoryDiscretionRule — may widen the floor for aged stock.
          5. QuantityTierRule — records the tier-approved price.
          6. MaxDiscountRule  — cap total discount and gate merchant approval.

        Args:
            max_rounds:                Max negotiation rounds before expiry flag.
            auto_approve_threshold_pct: See MaxDiscountRule docs.
        """
        round_limit_rule = RoundLimitRule(max_rounds=max_rounds)
        rules: list[PricingRule] = [
            round_limit_rule,
            FloorPriceRule(),
            MarginFloorRule(),
            InventoryDiscretionRule(),
            QuantityTierRule(),
            MaxDiscountRule(auto_approve_threshold_pct=auto_approve_threshold_pct),
        ]
        engine = cls(rules)
        engine._round_limit_rule = round_limit_rule  # keep reference for price update
        return engine

    # ------------------------------------------------------------------
    # Evaluation
    # ------------------------------------------------------------------

    def evaluate(self, offer: Offer, policy: PricingPolicy) -> GuardrailResult:
        """Run all rules in order, threading the effective price through the waterfall.

        Args:
            offer:  The buyer's current proposal.  ``offer.proposed_price`` is the
                    starting price; rules may adjust it downward as the waterfall runs.
            policy: The hidden pricing policy for the SKU.

        Returns:
            A ``GuardrailResult`` with the final approved price and full audit trail.
        """
        current_price = offer.proposed_price
        rule_results: list[RuleResult] = []
        blocking_rule: str | None = None
        deciding_rule: str | None = None
        requires_merchant_approval: bool = False
        is_round_limit_final: bool = False

        orig_proposed = offer.original_proposed_price if offer.original_proposed_price is not None else offer.proposed_price
        for rule in self._rules:
            # Build a view of the offer with the waterfall-adjusted price while preserving original proposed price
            waterfall_offer = offer.model_copy(
                update={
                    "proposed_price": current_price,
                    "original_proposed_price": orig_proposed,
                }
            )

            result = rule.evaluate(waterfall_offer, policy)
            rule_results.append(result)

            # Log every rule outcome
            if result.passed:
                log.info(
                    "guardrail_rule_passed",
                    rule=result.rule_name,
                    proposed_price=current_price,
                    adjusted_price=result.adjusted_price,
                )
            else:
                log.warning(
                    "guardrail_rule_violated",
                    rule=result.rule_name,
                    proposed_price=current_price,
                    adjusted_price=result.adjusted_price,
                    action="clamped",
                )
            if result.requires_merchant_approval:
                log.info(
                    "guardrail_needs_approval",
                    rule=result.rule_name,
                    proposed_price=current_price,
                )

            # Advance price through the waterfall.
            # Inline the adjusted-vs-original logic here; no property needed on RuleResult.
            if result.adjusted_price is not None:
                current_price = result.adjusted_price
                # This rule produced the number we're now working with — it is
                # the current candidate for deciding_rule.
                deciding_rule = result.rule_name

            # Track merchant-approval requirement (any rule can set it)
            if result.requires_merchant_approval:
                requires_merchant_approval = True

            # Track the FIRST rule that set passed=False (audit — "who fired first")
            if not result.passed and blocking_rule is None:
                blocking_rule = result.rule_name

            # Detect round-limit final-offer flag
            if result.rule_name == "round_limit" and result.reason == "round_limit_reached":
                is_round_limit_final = True
                # Short-circuit — remaining rules are skipped.
                # final price is last_approved_price (already set as current_price above).
                break

        # Update the round-limit rule's last_approved_price for the next round
        if hasattr(self, "_round_limit_rule") and not is_round_limit_final:
            self._round_limit_rule.set_last_approved_price(current_price)

        passed = blocking_rule is None

        return GuardrailResult(
            final_price=round(current_price, 2),
            passed=passed,
            requires_merchant_approval=requires_merchant_approval,
            blocking_rule=blocking_rule,
            deciding_rule=deciding_rule,
            rule_results=rule_results,
            is_round_limit_final=is_round_limit_final,
        )
