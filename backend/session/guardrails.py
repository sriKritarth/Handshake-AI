"""Post-LLM guardrail clamp and logical conflict resolution."""
from __future__ import annotations

from session.models import NegotiationDecision


def apply_post_llm_guardrails(
    decision: NegotiationDecision,
    floor_price: float,
    margin_floor: float,
) -> NegotiationDecision:
    """Clamp prices to policy floor and resolve contradictory boolean flags."""
    # 1. Hard floor clamp
    if decision.counter_price < floor_price:
        decision.counter_price = floor_price
        if "[GUARDRAIL: price was clamped to floor]" not in decision.internal_reasoning:
            decision.internal_reasoning += " [GUARDRAIL: price was clamped to floor]"

    # 2. Fix contradictory flags (accept takes priority over approval)
    if decision.should_accept and decision.needs_approval:
        decision.needs_approval = False

    # 3. If needs_approval is set but price is above margin_floor, auto-accept
    if decision.needs_approval and decision.counter_price >= margin_floor:
        decision.needs_approval = False
        decision.should_accept = True

    return decision
