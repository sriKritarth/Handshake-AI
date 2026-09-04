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
    """LLM buyer agent that negotiates against the seller API with Total Outlay & Budget awareness.

    config = {
        "product_name": "Premium T-Shirt",
        "sku_code":      "TSH-PREM-001",
        "quantity":      50,
        "list_price":    1499.0,   # seller's listed MRP
        "target_price":  1150.0,   # what you ideally want to pay
        "walk_away_price": 1350.0, # absolute max you'll pay
        "opening_offer": 1000.0,   # your first offer (low anchor)
        "max_rounds":    5,
        "max_budget":    67500.0,  # optional, defaults to quantity * walk_away_price
        "max_quantity":  62,       # optional, defaults to int(quantity * 1.25)
    }
    """

    def __init__(self, config: dict) -> None:
        self.config = config
        self.client = _make_client()

        # Financial & capacity boundaries
        self.base_quantity: int = int(config.get("quantity", 50))
        self.target_price: float = float(config.get("target_price", 1150.0))
        self.walk_away_price: float = float(config.get("walk_away_price", 1350.0))
        self.target_budget: float = float(config.get("target_budget", self.base_quantity * self.target_price))
        self.max_budget: float = float(config.get("max_budget", self.base_quantity * self.walk_away_price))
        self.max_quantity: int = int(config.get("max_quantity", int(self.base_quantity * 1.25)))
        self.min_quantity: int = int(config.get("min_quantity", max(1, int(self.base_quantity * 0.80))))

        self.system_prompt = build_buyer_system_prompt(config)
        self.history: list[dict] = []
        self.current_round = 0
        self.last_buyer_offer: float | None = None
        self.last_buyer_quantity: int | None = None
        self.last_seller_counter: float | None = None
        self.last_seller_quantity: int | None = None

    def _format_history(self) -> str:
        if not self.history:
            return "No prior rounds."
        lines = []
        for entry in self.history:
            b_qty = entry.get("buyer_quantity", self.base_quantity)
            s_qty = entry.get("seller_quantity", self.base_quantity)
            b_total = entry["buyer_offer"] * b_qty
            s_total = entry["seller_counter"] * s_qty
            lines.append(
                f"Round {entry['round']}:\n"
                f"  → Buyer offered ₹{entry['buyer_offer']:.2f}/unit for {b_qty} units (Total: ₹{b_total:,.2f}) — \"{entry['buyer_message']}\"\n"
                f"  ← Seller countered ₹{entry['seller_counter']:.2f}/unit for {s_qty} units (Total: ₹{s_total:,.2f}) — \"{entry['seller_justification']}\""
            )
        return "\n".join(lines)

    def decide(
        self,
        seller_counter: float | None = None,
        seller_justification: str | None = None,
        seller_quantity: int | None = None,
    ) -> BuyerDecision:
        """Return the buyer's next decision via Groq LLM with dual-metric total outlay optimization."""
        self.current_round += 1
        eff_seller_quantity = seller_quantity if seller_quantity is not None else self.base_quantity

        if self.current_round == 1:
            user_prompt = build_buyer_round_one_prompt(self.config)
        elif self.current_round >= self.config.get("max_rounds", 5):
            user_prompt = build_buyer_final_round_prompt(
                self.config,
                seller_counter,
                self._format_history(),
                self.last_buyer_offer or self.config.get("opening_offer", self.target_price * 0.85),
                seller_quantity=eff_seller_quantity,
                last_buyer_quantity=self.last_buyer_quantity or self.base_quantity,
            )
        else:
            user_prompt = build_buyer_middle_round_prompt(
                self.config,
                seller_counter,
                self.current_round,
                self._format_history(),
                self.last_buyer_offer or self.config.get("opening_offer", self.target_price * 0.85),
                seller_quantity=eff_seller_quantity,
                last_buyer_quantity=self.last_buyer_quantity or self.base_quantity,
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

        # Ensure default offer_quantity if missing or non-positive
        if not decision.offer_quantity or decision.offer_quantity <= 0:
            decision.offer_quantity = self.base_quantity

        # Post-LLM Guardrail 1: Hard Total Outlay & Budget Cap Protection on Accept
        # When seller inflates quantity beyond max_quantity or total outlay beyond max_budget:
        # e.g., Seller asks ₹320 for 50 units (₹16,000) when buyer planned 35 units @ ₹340 (Budget cap ₹12,600).
        if decision.should_accept and seller_counter is not None:
            seller_total_outlay = seller_counter * eff_seller_quantity
            violates_budget = seller_total_outlay > self.max_budget
            violates_storage = eff_seller_quantity > self.max_quantity
            violates_unit_price = seller_counter > self.walk_away_price

            if violates_budget or violates_storage or violates_unit_price:
                decision.should_accept = False
                affordable_qty = min(self.max_quantity, max(self.min_quantity, int(self.max_budget // seller_counter)))
                decision.offer_quantity = affordable_qty
                decision.offer_price = seller_counter
                decision.total_outlay = round(decision.offer_price * decision.offer_quantity, 2)
                reason_trigger = "budget cap" if violates_budget else ("volume limit" if violates_storage else "walk-away price")
                decision.internal_reasoning += (
                    f" [GUARDRAIL: Rejected acceptance — seller proposal of {eff_seller_quantity} units at ₹{seller_counter:.2f} "
                    f"(Total ₹{seller_total_outlay:,.2f}) breaches {reason_trigger} (Max Budget: ₹{self.max_budget:,.2f}, Max Qty: {self.max_quantity}). "
                    f"Countering with affordable batch of {affordable_qty} units at ₹{seller_counter:.2f} (Total ₹{decision.total_outlay:,.2f}).]"
                )
                decision.message = (
                    f"We appreciate the ₹{seller_counter:.2f} unit rate, but our procurement budget is capped at ₹{self.max_budget:,.0f}. "
                    f"We can commit to {affordable_qty} units at ₹{seller_counter:.2f} (total ₹{decision.total_outlay:,.0f})."
                )

        # Post-LLM Guardrail 2: Never exceed walk-away unit price
        if decision.offer_price > self.walk_away_price:
            decision.offer_price = self.walk_away_price
            decision.internal_reasoning += " [GUARDRAIL: clamped to walk-away price]"

        # Post-LLM Guardrail 3: Cap per-round unit price increase to MAX_OFFER_INCREASE_PCT
        # Only applies when not accepting and not round 1
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

        # Round 1 anchoring discipline: always start at opening offer and base quantity
        if self.current_round == 1:
            decision.offer_price = float(self.config.get("opening_offer", self.target_price * 0.85))
            decision.offer_quantity = self.base_quantity
            decision.should_accept = False
            decision.should_walk_away = False

        # Post-LLM Guardrail 4: Sync total outlay math
        decision.total_outlay = round(decision.offer_price * decision.offer_quantity, 2)

        # If buyer is accepting a valid seller offer, sync offer_price and offer_quantity to seller's terms
        if decision.should_accept and seller_counter is not None:
            decision.offer_price = seller_counter
            decision.offer_quantity = eff_seller_quantity
            decision.total_outlay = round(decision.offer_price * decision.offer_quantity, 2)

        self.last_buyer_offer = decision.offer_price
        self.last_buyer_quantity = decision.offer_quantity
        self.last_seller_counter = seller_counter
        self.last_seller_quantity = eff_seller_quantity

        return decision

    def record_round(
        self,
        buyer_offer: float,
        buyer_message: str,
        seller_counter: float,
        seller_justification: str,
        buyer_quantity: int | None = None,
        seller_quantity: int | None = None,
    ) -> None:
        """Record a completed round for future prompt context."""
        self.history.append({
            "round": self.current_round,
            "buyer_offer": buyer_offer,
            "buyer_message": buyer_message,
            "buyer_quantity": buyer_quantity or self.base_quantity,
            "seller_counter": seller_counter,
            "seller_justification": seller_justification,
            "seller_quantity": seller_quantity or self.base_quantity,
        })

