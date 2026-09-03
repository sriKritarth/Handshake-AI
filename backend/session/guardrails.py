"""Post-LLM guardrail clamp and logical conflict resolution."""
from __future__ import annotations

import structlog
from session.models import NegotiationDecision

log = structlog.get_logger()


def apply_post_llm_guardrails(
    decision: NegotiationDecision,
    floor_price: float,
    margin_floor: float,
) -> NegotiationDecision:
    """Clamp prices to policy floor and resolve contradictory boolean flags."""
    # 1. Hard floor clamp
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

    # 2. Fix contradictory flags (accept takes priority over approval)
    if decision.should_accept and decision.needs_approval:
        log.warning(
            "guardrail_flag_conflict",
            should_accept=True,
            needs_approval=True,
            resolution="accept_takes_priority",
        )
        decision.needs_approval = False

    # 3. If needs_approval is set but price is above margin_floor, auto-accept
    if decision.needs_approval and decision.counter_price >= margin_floor:
        log.info(
            "guardrail_needs_approval",
            proposed_price=decision.counter_price,
            floor=floor_price,
            margin_floor=margin_floor,
        )
        decision.needs_approval = False
        decision.should_accept = True

    return decision
