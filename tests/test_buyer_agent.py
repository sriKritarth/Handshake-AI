"""
LLM integration tests for the buyer agent.

These tests hit the REAL Groq API — they verify the LLM produces
bounded, strategically-sane output across multiple rounds.

Run:
    pytest tests/test_buyer_agent.py -v
"""
from __future__ import annotations

import os
import sys

import pytest

# Make project root importable when running from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(dotenv_path=".env", override=True)

from demo.buyer_agent.agent import BuyerAgent

# ---------------------------------------------------------------------------
# Shared config — mirrors the a2a_demo BUYER_CONFIG values
# ---------------------------------------------------------------------------
TEST_CONFIG = {
    "product_name":    "Premium Heavyweight Cotton T-Shirt",
    "sku_code":        "TSH-PREM-001",
    "quantity":        50,
    "list_price":      1499.0,
    "target_price":    1150.0,
    "walk_away_price": 1350.0,
    "opening_offer":   950.0,
    "max_rounds":      5,
}


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_buyer_opening_offer_matches_config():
    """Round 1 offer must equal opening_offer regardless of LLM output."""
    agent = BuyerAgent(TEST_CONFIG)
    decision = agent.decide()
    assert decision.offer_price == TEST_CONFIG["opening_offer"], (
        f"Expected opening offer ₹{TEST_CONFIG['opening_offer']} "
        f"but got ₹{decision.offer_price}"
    )
    assert not decision.should_accept, "Buyer should not accept in round 1 with no counter"
    assert not decision.should_walk_away, "Buyer should not walk away in round 1"


def test_buyer_decision_fields_are_populated():
    """Every BuyerDecision must have all required fields populated."""
    agent = BuyerAgent(TEST_CONFIG)
    d = agent.decide()

    assert d.offer_price > 0, "offer_price must be positive"
    assert len(d.message) > 0, "message must not be empty"
    assert len(d.internal_reasoning) > 0, "internal_reasoning must not be empty"
    assert isinstance(d.should_accept, bool), "should_accept must be a bool"
    assert isinstance(d.should_walk_away, bool), "should_walk_away must be a bool"


def test_buyer_never_exceeds_walk_away():
    """No offer from the buyer should exceed walk_away_price across 4+ rounds."""
    agent = BuyerAgent(TEST_CONFIG)
    walk_away = TEST_CONFIG["walk_away_price"]

    # Round 1
    d1 = agent.decide()
    agent.record_round(d1.offer_price, d1.message, 1450.0, "List price")

    # Round 2: seller barely moved
    d2 = agent.decide(seller_counter=1440.0, seller_justification="Firm on price")
    agent.record_round(d2.offer_price, d2.message, 1440.0, "Firm")

    # Round 3: seller still high
    d3 = agent.decide(seller_counter=1420.0, seller_justification="Best I can do")
    agent.record_round(d3.offer_price, d3.message, 1420.0, "Best I can do")

    # Round 4
    d4 = agent.decide(seller_counter=1400.0, seller_justification="Final territory")

    for i, d in enumerate([d1, d2, d3, d4], start=1):
        assert d.offer_price <= walk_away, (
            f"Round {i}: buyer offered ₹{d.offer_price} which exceeds "
            f"walk-away ₹{walk_away}"
        )


def test_buyer_accepts_when_seller_below_target():
    """If seller counters at or below target_price, buyer should accept."""
    agent = BuyerAgent(TEST_CONFIG)
    target = TEST_CONFIG["target_price"]

    # Round 1
    d1 = agent.decide()
    agent.record_round(d1.offer_price, d1.message, target - 10, "Special bulk deal")

    # Round 2: seller is below target
    d2 = agent.decide(
        seller_counter=target - 10,
        seller_justification="Best offer for bulk order",
    )

    assert d2.should_accept, (
        f"Buyer should accept ₹{target - 10} (below target ₹{target}) but didn't"
    )


def test_buyer_walks_away_when_seller_wont_budge():
    """Buyer must eventually walk away if seller stays above walk-away price."""
    agent = BuyerAgent(TEST_CONFIG)
    walk_away = TEST_CONFIG["walk_away_price"]

    # Seller barely moves from ~1450 → 1440 → 1430 → 1420 → 1415 (all above walk-away)
    seller_prices = [1450, 1440, 1430, 1420, 1415]

    walked_away = False
    for i, seller_price in enumerate(seller_prices):
        if i == 0:
            d = agent.decide()
        else:
            d = agent.decide(
                seller_counter=float(seller_price),
                seller_justification="This is our best rate",
            )

        if d.should_walk_away:
            walked_away = True
            break

        agent.record_round(
            d.offer_price, d.message, float(seller_price), "Best rate"
        )

    assert walked_away, (
        f"Buyer never walked away despite seller always staying above "
        f"walk-away ₹{walk_away}"
    )


def test_buyer_increases_offers_gradually():
    """Buyer's offer should increase by no more than 8% per round when NOT accepting."""
    agent = BuyerAgent(TEST_CONFIG)
    decisions: list = []

    # Round 1
    d = agent.decide()
    decisions.append(d)
    agent.record_round(d.offer_price, d.message, 1450.0, "Standard pricing")

    # Rounds 2-4: seller moves slowly to pressure buyer upward
    for seller_price in [1400.0, 1360.0, 1330.0]:
        d = agent.decide(seller_counter=seller_price, seller_justification="Adjusted")
        decisions.append(d)
        agent.record_round(d.offer_price, d.message, seller_price, "Adjusted")

    # Validate step-by-step increase is bounded — skip when buyer is accepting
    for i in range(1, len(decisions)):
        prev_d, curr_d = decisions[i - 1], decisions[i]
        # When the buyer accepts, offer_price == seller's counter (expected jump) — skip
        if curr_d.should_accept:
            continue
        prev_price, curr_price = prev_d.offer_price, curr_d.offer_price
        if curr_price > prev_price:
            increase_pct = ((curr_price - prev_price) / prev_price) * 100
            assert increase_pct <= 8.0, (
                f"Round {i + 1}: buyer jumped {increase_pct:.1f}% "
                f"(₹{prev_price:.0f} → ₹{curr_price:.0f}) — exceeds 8% guardrail"
            )


def test_buyer_rejects_volume_upsell_exceeding_budget():
    """Verify buyer agent rejects seller volume upsell when total spend exceeds budget.

    Scenario:
      - Buyer wants 35 units @ target ₹340 (Planned budget: ₹11,900, Walk-away ₹360 -> Max budget ₹12,600).
      - Seller offers ₹320 (lower unit rate!) but upsells quantity to 50 units (Total outlay: ₹16,000).
      - Buyer must NOT accept (should_accept == False) because total outlay ₹16,000 exceeds ₹12,600 budget.
      - Buyer must counter with affordable batch (<= 39 units) respecting budget constraint.
    """
    config = {
        "product_name": "Premium Cotton T-Shirt",
        "sku_code": "TSH-PREM-001",
        "quantity": 35,
        "list_price": 499.0,
        "target_price": 340.0,
        "walk_away_price": 360.0,
        "opening_offer": 300.0,
        "max_rounds": 5,
        "max_budget": 12600.0,  # 35 * 360
        "max_quantity": 43,     # 35 * 1.25 approx
    }
    agent = BuyerAgent(config)

    # Round 1: Buyer opens
    d1 = agent.decide()
    assert d1.offer_price == 300.0
    assert d1.offer_quantity == 35
    assert not d1.should_accept

    # Round 2: Seller proposes 320 unit price, but demands 50 units (Total outlay = 16,000 > 12,600 budget)
    d2 = agent.decide(
        seller_counter=320.0,
        seller_justification="We can offer ₹320 per unit if you increase your order volume to 50 units.",
        seller_quantity=50,
    )

    # 1. Must NOT accept the 50-unit order despite lower unit price (320 < 340)
    assert not d2.should_accept, (
        f"Buyer agent erroneously accepted! Seller total outlay was ₹{320 * 50:,.2f} "
        f"which exceeds buyer's budget cap ₹{config['max_budget']:,.2f}"
    )

    # 2. Buyer's counter must be within budget cap
    assert d2.total_outlay <= config["max_budget"], (
        f"Buyer counter total outlay ₹{d2.total_outlay} exceeds budget cap ₹{config['max_budget']}"
    )

    # 3. Buyer's counter quantity must not exceed storage capacity
    assert d2.offer_quantity <= config["max_quantity"], (
        f"Buyer counter quantity {d2.offer_quantity} exceeds max quantity {config['max_quantity']}"
    )
    assert d2.offer_quantity >= config["quantity"] * 0.8

