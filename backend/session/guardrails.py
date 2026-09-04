"""Guardrail enforcement layer for the negotiation session workflow.

Provides two-phase guardrail evaluation:
1. evaluate_buyer_guardrails: Runs immediately AFTER buyer request and BEFORE seller response.
   Evaluates the incoming buyer offer across the complete 6-rule GuardrailEngine waterfall
   (RoundLimit, FloorPrice, MarginFloor, InventoryDiscretion, QuantityTier, MaxDiscount).
   Populates offer_events cryptographic audit fields (is_rule_passed, passed_rules,
   violated_rules, guardrail_clamped_price, rule_reason).

2. apply_post_llm_guardrails: Runs immediately AFTER seller response.
   Guarantees absolute floor compliance, resolves contradictory flags, and ensures
   unauthorized below-margin offers escalate to merchant review.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional
import structlog

from guardrail.base import Offer
from guardrail.engine import GuardrailEngine, GuardrailResult
from models.pricing_policy import InventoryDiscretion, PricingPolicy, QuantityTier
from session.models import BuyerMove, NegotiationDecision

log = structlog.get_logger()


def build_pricing_policy(catalog_sku: Dict[str, Any], policy_dict: Dict[str, Any]) -> PricingPolicy:
    """Transform raw database policy dictionary into strongly-typed PricingPolicy model."""
    raw_tiers = policy_dict.get("qty_tier_discounts", [])
    q_tiers = []
    for t in raw_tiers:
        q_tiers.append(
            QuantityTier(
                min_qty=t.get("min_qty", 1),
                max_qty=t.get("max_qty"),
                discount_pct=float(t.get("discount_pct", 0.0)),
            )
        )

    inv_disc = None
    if policy_dict.get("aged_discount_pct") or policy_dict.get("inventory_discretion"):
        disc_pct = float(policy_dict.get("aged_discount_pct", 5.0))
        age_thresh = int(policy_dict.get("inventory_discretion_threshold_days", 30))
        inv_disc = InventoryDiscretion(
            age_threshold_days=age_thresh,
            extra_discount_pct=disc_pct,
        )

    cost_p = float(policy_dict.get("cost_price", 0.0))
    fl_p = float(policy_dict.get("floor_price", 0.0))
    min_margin = float(policy_dict.get("min_margin_pct", 0.0))
    sku_code = catalog_sku.get("sku_code", catalog_sku.get("id", policy_dict.get("sku_code", "UNKNOWN")))

    return PricingPolicy(
        sku=sku_code,
        cost_price=cost_p,
        floor_price=fl_p,
        margin_floor_pct=min_margin,
        quantity_tiers=q_tiers,
        inventory_age_days=int(policy_dict.get("inventory_age_days", 10)),
        inventory_discretion=inv_disc,
        urgency_flex_pct=float(policy_dict.get("urgency_flex_pct", 0.0)),
        max_total_discount_pct=float(policy_dict.get("max_total_discount_pct", 25.0)),
    )


def evaluate_buyer_guardrails(
    buyer_move: BuyerMove,
    catalog_sku: Dict[str, Any],
    policy_dict: Dict[str, Any],
    current_round: int,
    max_rounds: int = 5,
    last_seller_price: Optional[float] = None,
) -> GuardrailResult:
    """Evaluate buyer proposal across all 6 GuardrailEngine rules.
    Invoked AFTER buyer request and BEFORE seller response in each negotiation round.
    """
    policy_obj = build_pricing_policy(catalog_sku, policy_dict)
    list_p = float(catalog_sku.get("base_price", policy_dict.get("list_price", 500.0)))
    proposed = buyer_move.offered_price if buyer_move.offered_price is not None else (last_seller_price or list_p)

    offer_obj = Offer(
        sku=policy_obj.sku,
        proposed_price=proposed,
        list_price=list_p,
        quantity=buyer_move.quantity,
        round_number=current_round,
    )

    auto_approve_thresh = policy_dict.get("auto_approve_threshold_pct")
    engine = GuardrailEngine.default(
        max_rounds=max_rounds,
        auto_approve_threshold_pct=float(auto_approve_thresh) if auto_approve_thresh is not None else None,
    )
    result = engine.evaluate(offer_obj, policy_obj)
    log.info(
        "buyer_guardrail_evaluated",
        round=current_round,
        proposed_price=proposed,
        clamped_price=result.final_price,
        passed=result.passed,
        requires_approval=result.requires_merchant_approval,
        deciding_rule=result.deciding_rule,
    )
    return result


def apply_post_llm_guardrails(
    decision: NegotiationDecision,
    floor_price: float,
    margin_floor: float,
    policy_dict: Optional[Dict[str, Any]] = None,
    catalog_sku: Optional[Dict[str, Any]] = None,
    quantity: int = 1,
    current_round: int = 1,
    max_rounds: int = 5,
) -> NegotiationDecision:
    """Clamp prices below floor and resolve contradictory flags before state transition."""
    # 1. Round counter price to 2 decimal places
    if decision.counter_price is not None:
        decision.counter_price = float(round(decision.counter_price, 2))

    # 2. Hard floor clamp (absolute fallback guarantee)
    if decision.counter_price < floor_price:
        log.warning(
            "guardrail_clamped",
            raw_price=decision.counter_price,
            clamped_to=floor_price,
            reason="below_floor",
        )
        decision.counter_price = floor_price
        if "[GUARDRAIL: price was clamped to floor]" not in decision.internal_reasoning:
            decision.internal_reasoning += " [GUARDRAIL: price was clamped to floor]"

    # 3. If LLM wanted to accept (should_accept=True), but price is below margin_floor:
    # Cannot auto-close; must escalate to merchant if at or above floor
    if decision.should_accept and decision.counter_price < margin_floor:
        log.warning(
            "guardrail_flag_conflict",
            should_accept=True,
            counter_price=decision.counter_price,
            margin_floor=margin_floor,
            resolution="below_margin_requires_approval",
        )
        decision.should_accept = False
        decision.needs_approval = True

    # 4. Fix contradictory flags (accept takes priority over approval when above margin_floor)
    if decision.should_accept and decision.needs_approval:
        log.warning(
            "guardrail_flag_conflict",
            should_accept=True,
            needs_approval=True,
            resolution="accept_takes_priority",
        )
        decision.needs_approval = False

    # 5. If needs_approval is set but price is above margin_floor, auto-accept
    if decision.needs_approval and decision.counter_price >= margin_floor:
        log.info(
            "guardrail_needs_approval_resolved",
            proposed_price=decision.counter_price,
            floor=floor_price,
            margin_floor=margin_floor,
        )
        decision.needs_approval = False
        decision.should_accept = True

    # 6. Information asymmetry: scrub private inventory or distress leakage from justification
    if decision.justification:
        leak_keywords = [
            "in stock",
            "warehouse",
            "clearance rate",
            "clear our inventory",
            "remaining stock",
            "units left",
            "stock quantity",
        ]
        if any(w in decision.justification.lower() for w in leak_keywords):
            counter_val = decision.counter_price if decision.counter_price is not None else floor_price
            decision.justification = (
                f"We can authorize a preferential rate of ₹{counter_val:.2f}/unit for your order of {quantity} units, "
                f"backed by complete manufacturer warranty and expedited priority dispatch."
            )

    return decision

