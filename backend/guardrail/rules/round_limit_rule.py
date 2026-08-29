"""
RoundLimitRule — negotiation round-count enforcement.

Per the briefing:
  "Round-limit expiry: present the lowest guardrail-approved offer as a
   final take-it-or-leave-it choice with an expiry timestamp, not a hard
   termination."

This rule flags when the maximum number of negotiation rounds has been reached.
It does NOT terminate the session — that is the engine's responsibility.  It
returns passed=False with reason="round_limit_reached" so the engine knows to
package the last approved price as the final take-it-or-leave-it offer.

Constructor:
    max_rounds (int):            Maximum number of allowed rounds (default 5).
    last_approved_price (float): The best (lowest) price approved by the full
                                 guardrail waterfall in the previous round.
                                 The engine updates this via set_last_approved_price()
                                 after each successful evaluation.
"""

from guardrail.base import Offer, PricingRule, RuleResult
from models.pricing_policy import PricingPolicy


class RoundLimitRule(PricingRule):
    """Flag when the negotiation has consumed all allowed rounds.

    When ``offer.round_number >= max_rounds``:
      - Returns passed=False, reason="round_limit_reached"
      - adjusted_price is set to last_approved_price so the engine can present
        it as the final take-it-or-leave-it offer.

    When within the round limit:
      - Returns passed=True with no adjustment.
    """

    def __init__(self, max_rounds: int = 5, last_approved_price: float | None = None) -> None:
        """
        Args:
            max_rounds:           Max rounds before flagging expiry (default 5).
            last_approved_price:  The lowest guardrail-approved price from all
                                  previous rounds, used as the final offer anchor.
                                  Defaults to None (engine should set this after
                                  each round via set_last_approved_price()).
        """
        self.max_rounds = max_rounds
        self._last_approved_price = last_approved_price

    def set_last_approved_price(self, price: float) -> None:
        """Called by the GuardrailEngine after each successful evaluation round."""
        self._last_approved_price = price

    def evaluate(self, offer: Offer, policy: PricingPolicy) -> RuleResult:
        if offer.round_number >= self.max_rounds:
            # Round limit reached — present last approved price as final offer
            return RuleResult(
                passed=False,
                rule_name="round_limit",
                original_price=offer.proposed_price,
                adjusted_price=self._last_approved_price,  # may be None on first round
                reason="round_limit_reached",
            )

        return RuleResult(
            passed=True,
            rule_name="round_limit",
            original_price=offer.proposed_price,
            adjusted_price=None,
            reason="ok",
        )