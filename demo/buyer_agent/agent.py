"""LLM-powered buyer agent core — uses Instructor + Groq for structured decisions."""
from __future__ import annotations

import os

# Model to use for buyer LLM decisions.
# Must be available on your Groq account; matches the seller agent's default.
DEFAULT_BUYER_MODEL = os.getenv("GROQ_BUYER_MODEL", "qwen/qwen3.8-27b")

# Hard cap on how much the buyer can increase their offer in a single round (%).
# The system prompt says 5%, but LLMs can drift — this is the hard enforcement line.
MAX_OFFER_INCREASE_PCT = float(os.getenv("MAX_OFFER_INCREASE_PCT", "8.0"))

import instructor
from groq import Groq

from .models import BuyerDecision
from .prompts import (
    build_buyer_system_prompt,
    build_buyer_round_one_prompt,
    build_buyer_middle_round_prompt,
    build_buyer_final_round_prompt,
)


def _make_client() -> instructor.Instructor:
    """Create Instructor-patched Groq client using TOOLS mode for structured output."""
    groq = Groq(api_key=os.environ.get("GROQ_API_KEY"))
    return instructor.from_groq(groq, mode=instructor.Mode.TOOLS)


class BuyerAgent:
    """LLM buyer agent that negotiates against the seller API.

    config = {
        "product_name": "Premium T-Shirt",
        "sku_code":      "TSH-PREM-001",
        "quantity":      50,
        "list_price":    1499.0,   # seller's listed MRP
        "target_price":  1150.0,   # what you ideally want to pay
        "walk_away_price": 1350.0, # absolute max you'll pay
        "opening_offer": 1000.0,   # your first offer (low anchor)
        "max_rounds":    5,
    }
    """

    def __init__(self, config: dict) -> None:
        self.config = config
        self.client = _make_client()
        self.system_prompt = build_buyer_system_prompt(config)
        self.history: list[dict] = []
        self.current_round = 0
        self.last_buyer_offer: float | None = None
        self.last_seller_counter: float | None = None

    def _format_history(self) -> str:
        if not self.history:
            return "No prior rounds."
        lines = []
        for entry in self.history:
            lines.append(
                f"Round {entry['round']}:\n"
                f"  → Buyer offered ₹{entry['buyer_offer']:.2f} — \"{entry['buyer_message']}\"\n"
                f"  ← Seller countered ₹{entry['seller_counter']:.2f} — \"{entry['seller_justification']}\""
            )
        return "\n".join(lines)

    def decide(
        self,
        seller_counter: float | None = None,
        seller_justification: str | None = None,
    ) -> BuyerDecision:
        """Return the buyer's next decision via Groq LLM."""
        self.current_round += 1

        if self.current_round == 1:
            user_prompt = build_buyer_round_one_prompt(self.config)
        elif self.current_round >= self.config["max_rounds"]:
            user_prompt = build_buyer_final_round_prompt(
                self.config,
                seller_counter,
                self._format_history(),
                self.last_buyer_offer,
            )
        else:
            user_prompt = build_buyer_middle_round_prompt(
                self.config,
                seller_counter,
                self.current_round,
                self._format_history(),
                self.last_buyer_offer,
            )

        decision: BuyerDecision = self.client.chat.completions.create(
            model=DEFAULT_BUYER_MODEL,
            response_model=BuyerDecision,
            messages=[
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
        )

        # Post-LLM guardrail 1: never exceed walk-away price
        if decision.offer_price > self.config["walk_away_price"]:
            decision.offer_price = self.config["walk_away_price"]
            decision.internal_reasoning += " [GUARDRAIL: clamped to walk-away price]"

        # Post-LLM guardrail 2: cap per-round increase to MAX_OFFER_INCREASE_PCT
        # Only applies when the buyer is NOT accepting (accepting = mirroring seller's price)
        if (
            not decision.should_accept
            and self.last_buyer_offer is not None
            and self.current_round > 1
            and decision.offer_price > self.last_buyer_offer
        ):
            max_allowed = self.last_buyer_offer * (1.0 + MAX_OFFER_INCREASE_PCT / 100.0)
            if decision.offer_price > max_allowed:
                decision.offer_price = round(max_allowed, 2)
                decision.internal_reasoning += (
                    f" [GUARDRAIL: increase capped at {MAX_OFFER_INCREASE_PCT}% per round]"
                )

        # Round 1: always use configured opening offer (anchoring discipline)
        if self.current_round == 1:
            decision.offer_price = self.config["opening_offer"]

        self.last_buyer_offer = decision.offer_price
        self.last_seller_counter = seller_counter

        return decision

    def record_round(
        self,
        buyer_offer: float,
        buyer_message: str,
        seller_counter: float,
        seller_justification: str,
    ) -> None:
        """Record a completed round for future prompt context."""
        self.history.append({
            "round": self.current_round,
            "buyer_offer": buyer_offer,
            "buyer_message": buyer_message,
            "seller_counter": seller_counter,
            "seller_justification": seller_justification,
        })
