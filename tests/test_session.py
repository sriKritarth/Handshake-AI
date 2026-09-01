"""Comprehensive unit and integration test suite for Phase 3 Negotiation Session Layer."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, patch
import pytest

# Ensure backend/ is in sys.path
BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..", "backend")
sys.path.insert(0, os.path.abspath(BACKEND_DIR))

from session.models import (
    BuyerMove,
    MerchantDecisionRequest,
    NegotiationDecision,
    SessionState,
)
from session.fsm import NegotiationFSM, InvalidStateTransitionError
from session.guardrails import apply_post_llm_guardrails
from session.prompts import (
    build_system_prompt,
    build_user_prompt,
    format_offer_history,
    format_tiers,
    pick_prompt_template,
)
from session.service import NegotiationSessionService
from session.db import InMemorySessionRepository, SessionRecord, OfferEventRecord


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_catalog_sku() -> Dict[str, Any]:
    return {
        "id": "sku_steel_m10_uuid",
        "sku_code": "SKU-1042",
        "name": "Steel Bolt M10",
        "category": "hardware",
        "description": "High tensile carbon steel bolts.",
        "base_price": 520.0,
        "inventory_qty": 2400,
        "tags": ["hardware", "fasteners", "steel"],
    }


@pytest.fixture
def sample_pricing_policy() -> Dict[str, Any]:
    return {
        "id": "pol_steel_m10_uuid",
        "sku_id": "sku_steel_m10_uuid",
        "sku_code": "SKU-1042",
        "cost_price": 350.0,
        "floor_price": 390.0,
        "margin_floor": 430.0,
        "min_margin_pct": 22.85,
        "qty_tier_discounts": [
            {"min_qty": 1, "max_qty": 9, "discount_pct": 0.0},
            {"min_qty": 10, "max_qty": 49, "discount_pct": 7.69},   # 480
            {"min_qty": 50, "max_qty": 99, "discount_pct": 11.54},  # 460
            {"min_qty": 100, "max_qty": 499, "discount_pct": 15.38}, # 440
            {"min_qty": 500, "max_qty": None, "discount_pct": 21.15}, # 410
        ],
        "inventory_age_days": 12,
        "urgency_flex_pct": 3.0,
        "max_total_discount_pct": 25.0,
        "auto_approve_threshold_pct": 15.0,
        "max_rounds": 5,
    }


# ---------------------------------------------------------------------------
# 1. Prompt Configuration & Round Router Tests
# ---------------------------------------------------------------------------

def test_tier_formatting(sample_pricing_policy: Dict[str, Any]) -> None:
    """Format quantity tiers into human-readable strings."""
    tiers_str = format_tiers(sample_pricing_policy["qty_tier_discounts"], sample_pricing_policy.get("base_price", 520.0))
    assert "1 to 9 units: ₹520.00" in tiers_str
    assert "500+ units" in tiers_str


def test_system_prompt_never_leaks_raw_keys(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """System prompt contains required guidance and confidential floor numbers."""
    sys_prompt = build_system_prompt(sample_catalog_sku, sample_pricing_policy)
    assert "Steel Bolt M10" in sys_prompt
    assert "Floor Price: ₹390.00" in sys_prompt
    assert "Margin Floor: ₹430.00" in sys_prompt
    assert "PERSONALITY" in sys_prompt
    assert "THINGS YOU MUST NEVER DO" in sys_prompt


def test_round_router_template_selection() -> None:
    """Round router picks ROUND_ONE, MIDDLE_ROUND, FINAL_ROUND, or BUYER_ACCEPTS."""
    # Round 1
    assert pick_prompt_template(current_round=1, max_rounds=5, accept_last_offer=False) == "ROUND_ONE"
    # Middle rounds
    assert pick_prompt_template(current_round=2, max_rounds=5, accept_last_offer=False) == "MIDDLE_ROUND"
    assert pick_prompt_template(current_round=4, max_rounds=5, accept_last_offer=False) == "MIDDLE_ROUND"
    # Final round
    assert pick_prompt_template(current_round=5, max_rounds=5, accept_last_offer=False) == "FINAL_ROUND"
    # Buyer accepts
    assert pick_prompt_template(current_round=3, max_rounds=5, accept_last_offer=True) == "BUYER_ACCEPTS"


def test_offer_history_formatting() -> None:
    """Offer history formatted with → for buyer and ← for seller."""
    history = [
        {"round_number": 1, "sender": "buyer", "proposed_price": 420.0, "public_justification": "Bulk order"},
        {"round_number": 1, "sender": "seller_ai", "proposed_price": 490.0, "public_justification": "Competitive standard rate"},
    ]
    formatted = format_offer_history(history)
    assert "Round 1:" in formatted
    assert "→ Buyer offered ₹420.00" in formatted
    assert "← Seller countered ₹490.00" in formatted


# ---------------------------------------------------------------------------
# 2. Post-LLM Guardrail Clamping & Contradiction Resolution
# ---------------------------------------------------------------------------

def test_post_llm_guardrail_clamps_below_floor() -> None:
    """Decision counter_price below floor is strictly clamped."""
    decision = NegotiationDecision(
        counter_price=350.0,  # Below floor 390
        justification="Special concession",
        internal_reasoning="Trying to win customer",
        should_accept=False,
        needs_approval=False,
    )
    clamped = apply_post_llm_guardrails(decision, floor_price=390.0, margin_floor=430.0)
    assert clamped.counter_price == 390.0
    assert "[GUARDRAIL: price was clamped to floor]" in clamped.internal_reasoning


def test_post_llm_guardrail_resolves_contradictory_flags() -> None:
    """Contradictory should_accept and needs_approval flags are normalized."""
    # Contradiction: both true -> should_accept wins
    d1 = NegotiationDecision(
        counter_price=440.0,
        justification="Deal",
        internal_reasoning="Ok",
        should_accept=True,
        needs_approval=True,
    )
    c1 = apply_post_llm_guardrails(d1, floor_price=390.0, margin_floor=430.0)
    assert c1.should_accept is True
    assert c1.needs_approval is False

    # Needs approval but price is above margin floor -> auto-accept
    d2 = NegotiationDecision(
        counter_price=450.0,
        justification="Deal",
        internal_reasoning="Ok",
        should_accept=False,
        needs_approval=True,
    )
    c2 = apply_post_llm_guardrails(d2, floor_price=390.0, margin_floor=430.0)
    assert c2.should_accept is True
    assert c2.needs_approval is False


# ---------------------------------------------------------------------------
# 3. Finite State Machine (FSM) Transitions & Invalid Action Rejection
# ---------------------------------------------------------------------------

def test_fsm_lifecycle_transitions() -> None:
    """FSM transitions through INITIATED -> IN_PROGRESS -> FINAL_OFFER -> AGREED."""
    record = SessionRecord(
        id="sess-001",
        sku_id="sku-001",
        buyer_id="buyer-01",
        status="INITIATED",
        current_round=0,
    )
    fsm = NegotiationFSM(record)

    # 1. Start negotiation
    fsm.start_negotiation()
    assert record.status == "IN_PROGRESS"

    # 2. Counter offer
    fsm.counter_offer()
    assert record.status == "IN_PROGRESS"

    # 3. Reach round limit
    fsm.reach_round_limit()
    assert record.status == "FINAL_OFFER"

    # 4. Accept final offer
    fsm.accept_final_offer()
    assert record.status == "AGREED"


def test_fsm_rejects_invalid_transitions() -> None:
    """Attempting transitions on terminal states raises InvalidStateTransitionError."""
    record = SessionRecord(
        id="sess-002",
        sku_id="sku-001",
        buyer_id="buyer-01",
        status="AGREED",
        current_round=3,
    )
    fsm = NegotiationFSM(record)

    with pytest.raises(InvalidStateTransitionError):
        fsm.counter_offer()

    with pytest.raises(InvalidStateTransitionError):
        fsm.start_negotiation()


# ---------------------------------------------------------------------------
# 4. End-to-End Service Tests: Scenarios 1 - 10 from Prompt Config Guide
# ---------------------------------------------------------------------------

class MockDecisionLLMClient:
    """Configurable mock returning predetermined NegotiationDecision objects."""

    def __init__(self, decisions: List[NegotiationDecision]) -> None:
        self.decisions = list(decisions)
        self.call_count = 0

    def get_seller_response(self, system_prompt: str, user_prompt: str) -> NegotiationDecision:
        self.call_count += 1
        if not self.decisions:
            raise RuntimeError("MockDecisionLLMClient called more times than decisions provided.")
        return self.decisions.pop(0)


def test_scenario_1_buyer_offers_above_margin_floor_accepted_immediately(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Scenario 1: Buyer offers ₹450 (above margin floor ₹430) in Round 1 -> AGREED immediately."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(
            counter_price=450.0,
            justification="We are pleased to accept your offer of ₹450/unit for 500 units.",
            internal_reasoning="Buyer is ₹20 above margin floor. Instant close.",
            should_accept=True,
            needs_approval=False,
        )
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_01", sku_code="SKU-1042")

    move = BuyerMove(
        quantity=500,
        offered_price=450.0,
        buyer_message="Ready to buy 500 units immediately.",
    )
    result = service.handle_buyer_move(session.id, move)

    assert result.status == "AGREED"
    assert result.final_agreed_price == 450.0
    assert result.payment_link_url is not None
    assert mock_llm.call_count == 1


def test_scenario_2_buyer_lowballs_in_r1_counter_near_list_price(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Scenario 2: Buyer offers ₹300 (below floor ₹390) in R1 -> Seller counters near list price."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(
            counter_price=490.0,
            justification="At 500 units our standard volume rate is ₹490 given high demand.",
            internal_reasoning="Lowball opening offer. Anchoring high at ₹490.",
            should_accept=False,
            needs_approval=False,
        )
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_02", sku_code="SKU-1042")

    move = BuyerMove(
        quantity=500,
        offered_price=300.0,
        buyer_message="Can you do 300?",
    )
    result = service.handle_buyer_move(session.id, move)

    assert result.status == "IN_PROGRESS"
    assert result.current_round == 1
    assert result.seller_proposed_price == 490.0


def test_scenario_3_buyer_lowballs_all_rounds_hits_final_offer(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Scenario 3: Buyer lowballs through max_rounds (5 rounds) -> FINAL_OFFER take-it-or-leave-it."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    # 5 decisions from LLM
    decisions = [
        NegotiationDecision(counter_price=500.0, justification="R1", internal_reasoning="", should_accept=False, needs_approval=False),
        NegotiationDecision(counter_price=480.0, justification="R2", internal_reasoning="", should_accept=False, needs_approval=False),
        NegotiationDecision(counter_price=460.0, justification="R3", internal_reasoning="", should_accept=False, needs_approval=False),
        NegotiationDecision(counter_price=440.0, justification="R4", internal_reasoning="", should_accept=False, needs_approval=False),
        NegotiationDecision(counter_price=410.0, justification="Final take it or leave it", internal_reasoning="Best and final", should_accept=False, needs_approval=False),
    ]
    mock_llm = MockDecisionLLMClient(decisions)

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_03", sku_code="SKU-1042")

    for r in range(1, 6):
        move = BuyerMove(quantity=500, offered_price=320.0, buyer_message=f"Round {r} lowball")
        res = service.handle_buyer_move(session.id, move)
        if r < 5:
            assert res.status == "IN_PROGRESS"
            assert res.current_round == r
        else:
            assert res.status == "FINAL_OFFER"
            assert res.current_round == 5
            assert res.final_offer_price == 410.0
            assert res.expires_at is not None


def test_scenario_4_buyer_gradually_increases_hits_margin_floor_in_r3(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Scenario 4: Buyer increases from 350 to 400 to 435 (above margin floor) -> AGREED in Round 3."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(counter_price=490.0, justification="R1 Counter", internal_reasoning="", should_accept=False, needs_approval=False),
        NegotiationDecision(counter_price=460.0, justification="R2 Counter", internal_reasoning="", should_accept=False, needs_approval=False),
        NegotiationDecision(counter_price=435.0, justification="R3 Accepted at 435", internal_reasoning="Above margin floor", should_accept=True, needs_approval=False),
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_04", sku_code="SKU-1042")

    r1 = service.handle_buyer_move(session.id, BuyerMove(quantity=500, offered_price=350.0))
    assert r1.status == "IN_PROGRESS"

    r2 = service.handle_buyer_move(session.id, BuyerMove(quantity=500, offered_price=400.0))
    assert r2.status == "IN_PROGRESS"

    r3 = service.handle_buyer_move(session.id, BuyerMove(quantity=500, offered_price=435.0))
    assert r3.status == "AGREED"
    assert r3.final_agreed_price == 435.0
    assert r3.payment_link_url is not None


def test_scenario_5_buyer_offer_between_floor_and_margin_escalates_to_merchant(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Scenario 5: Buyer offer between floor (390) and margin floor (430) triggers PENDING_APPROVAL."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(
            counter_price=405.0,
            justification="This special pricing requires management approval.",
            internal_reasoning="Between floor and margin floor. Escalating.",
            should_accept=False,
            needs_approval=True,
        )
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_05", sku_code="SKU-1042")

    move = BuyerMove(quantity=500, offered_price=405.0, buyer_message="Best we can do is 405.")
    res = service.handle_buyer_move(session.id, move)

    assert res.status == "PENDING_APPROVAL"
    assert res.pending_approval_price == 405.0

    # Merchant approves -> enters AGREED and generates payment link
    merchant_res = service.handle_merchant_decision(
        session_id=session.id,
        decision=MerchantDecisionRequest(decision="approve", merchant_notes="Approved for enterprise partner.")
    )
    assert merchant_res.status == "AGREED"
    assert merchant_res.final_agreed_price == 405.0
    assert merchant_res.payment_link_url is not None


def test_scenario_6_buyer_accepts_last_seller_offer(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Scenario 6: Buyer accepts last quoted seller counter-offer -> AGREED with seller price."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(counter_price=460.0, justification="Counter offer", internal_reasoning="", should_accept=False, needs_approval=False),
        NegotiationDecision(counter_price=460.0, justification="Confirmed deal at 460", internal_reasoning="", should_accept=True, needs_approval=False),
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_06", sku_code="SKU-1042")

    # Round 1
    service.handle_buyer_move(session.id, BuyerMove(quantity=500, offered_price=400.0, buyer_message="Offer"))

    # Buyer accepts last offer
    res = service.handle_buyer_move(session.id, BuyerMove(quantity=500, accept_last_offer=True))
    assert res.status == "AGREED"
    assert res.final_agreed_price == 460.0
    assert res.payment_link_url is not None


def test_scenario_7_buyer_sends_move_after_session_agreed_returns_error(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Scenario 7: Buyer sends move after session is AGREED -> returns error, no LLM call."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(counter_price=450.0, justification="Agreed", internal_reasoning="", should_accept=True, needs_approval=False)
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_07", sku_code="SKU-1042")

    # Agreement reached in Round 1
    service.handle_buyer_move(session.id, BuyerMove(quantity=500, offered_price=450.0))

    # Attempting another proposal on AGREED session
    with pytest.raises(InvalidStateTransitionError):
        service.handle_buyer_move(session.id, BuyerMove(quantity=500, offered_price=440.0))

    # Proves no second LLM call occurred
    assert mock_llm.call_count == 1


def test_scenario_8_lazy_check_expires_stale_final_offer(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Scenario 8: Expired final offer window is lazily evaluated and marked EXPIRED on read."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    service = NegotiationSessionService(repo=repo, llm_client=MockDecisionLLMClient([]))
    session = service.create_session(buyer_id="buyer_08", sku_code="SKU-1042")

    # Set session manually to FINAL_OFFER with expired timestamp
    past_time = datetime.now(timezone.utc) - timedelta(minutes=20)
    session.status = "FINAL_OFFER"
    session.expires_at = past_time
    session.final_offer_price = 420.0
    repo.update_session(session)

    # Fetching or acting on the session lazily triggers expiry
    fetched = service.get_session(session.id)
    assert fetched.status == "EXPIRED"

    # Accepting an expired session is rejected
    with pytest.raises(InvalidStateTransitionError):
        service.accept_offer(session.id, buyer_id="buyer_08")


def test_scenario_9_counter_price_below_floor_is_clamped_and_logged(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Scenario 9: Agent counter-price comes back < floor -> Guardrail clamps it to floor."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    # Mock LLM returns price 360 which is below floor 390
    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(counter_price=360.0, justification="Aggressive discount", internal_reasoning="Concession", should_accept=False, needs_approval=False)
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_09", sku_code="SKU-1042")

    res = service.handle_buyer_move(session.id, BuyerMove(quantity=500, offered_price=350.0))
    assert res.seller_proposed_price == 390.0  # Clamped to floor price


def test_pre_call_increment_budget_consumption(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Round counter is incremented in DB before the LLM call begins."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    class FailingLLMClient:
        def get_seller_response(self, sys_prompt: str, user_prompt: str) -> Any:
            raise RuntimeError("LLM Network Timeout!")

    service = NegotiationSessionService(repo=repo, llm_client=FailingLLMClient())
    session = service.create_session(buyer_id="buyer_09b", sku_code="SKU-1042")

    with pytest.raises(RuntimeError):
        service.handle_buyer_move(session.id, BuyerMove(quantity=500, offered_price=350.0))

    # Verify that round_count in DB incremented despite LLM crash
    persisted = repo.get_session(session.id)
    assert persisted.current_round == 1


def test_tamper_evident_audit_log_chaining(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Audit logs use SHA-256 cryptographic hash chaining across events."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(counter_price=480.0, justification="Offer", internal_reasoning="", should_accept=False, needs_approval=False),
        NegotiationDecision(counter_price=450.0, justification="Accept", internal_reasoning="", should_accept=True, needs_approval=False),
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_10", sku_code="SKU-1042")

    service.handle_buyer_move(session.id, BuyerMove(quantity=500, offered_price=400.0))
    service.handle_buyer_move(session.id, BuyerMove(quantity=500, offered_price=450.0))

    logs = repo.get_audit_logs(session.id)
    assert len(logs) >= 3

    # Verify hash chain continuity: log[i].previous_hash == log[i-1].current_hash
    for i in range(1, len(logs)):
        assert logs[i]["previous_hash"] == logs[i - 1]["current_hash"]
        assert len(logs[i]["current_hash"]) == 64  # Valid SHA-256


def test_merchant_counter_resume_template_and_flow(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Bug 1 & 2: Merchant counter sets status='COUNTERED' and resumes with MERCHANT_COUNTER_RESUME template."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    captured_prompts: List[str] = []

    class CapturingLLMClient:
        def __init__(self, responses: List[NegotiationDecision]) -> None:
            self.responses = responses
            self.call_idx = 0

        def get_seller_response(self, sys_prompt: str, user_prompt: str) -> NegotiationDecision:
            captured_prompts.append(user_prompt)
            res = self.responses[self.call_idx]
            self.call_idx += 1
            return res

    mock_llm = CapturingLLMClient([
        # R1: escalate to merchant
        NegotiationDecision(
            counter_price=390.0,
            justification="Escalating for review",
            internal_reasoning="Between floor and margin floor",
            should_accept=False,
            needs_approval=True,
        ),
        # R2 (after merchant counter): present merchant price
        NegotiationDecision(
            counter_price=430.0,
            justification="After review, we can offer ₹430 for 500 units.",
            internal_reasoning="Presented merchant counter",
            should_accept=False,
            needs_approval=False,
        ),
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_resumed", sku_code="SKU-1042", quantity=500)

    # 1. Buyer offers 390 -> escalated
    res1 = service.handle_buyer_move(session.id, BuyerMove(quantity=500, offered_price=390.0))
    assert res1.status == "PENDING_APPROVAL"

    # 2. Merchant counters with ₹430
    res_merchant = service.handle_merchant_decision(
        session.id,
        MerchantDecisionRequest(decision="counter", counter_price=430.0, merchant_notes="Approved special bulk deal at 430"),
    )
    assert res_merchant.status == "IN_PROGRESS"
    approval_entry = repo.merchant_approvals[session.id][-1]
    assert approval_entry["status"] == "COUNTERED"

    # 3. Buyer sends next move -> router should select MERCHANT_COUNTER_RESUME
    res2 = service.handle_buyer_move(session.id, BuyerMove(quantity=500, offered_price=400.0, buyer_message="Can you do 400?"))
    assert res2.status == "IN_PROGRESS"
    assert "NEGOTIATION RESUMED — Merchant Counter-Offer" in captured_prompts[1]
    assert "MERCHANT'S ADJUSTED PRICE: ₹430.00" in captured_prompts[1]
    assert "Approved special bulk deal at 430" in captured_prompts[1]


def test_guardrail_revalidation_blocks_depleted_stock_on_acceptance(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Bug 3: Accepting deal is blocked if stock is depleted before acceptance."""
    repo = InMemorySessionRepository()
    sku_data = dict(sample_catalog_sku)
    sku_data["inventory_qty"] = 100
    repo.save_catalog_sku(sku_data)
    repo.save_pricing_policy(sample_pricing_policy)

    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(counter_price=450.0, justification="Agreed", internal_reasoning="", should_accept=True, needs_approval=False),
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_stock_test", sku_code="SKU-1042", quantity=200)

    # Stock is only 100, but buyer asked for 200 units -> re-validation must reject
    with pytest.raises(ValueError, match="Insufficient stock"):
        service.handle_buyer_move(session.id, BuyerMove(quantity=200, offered_price=450.0))


def test_guardrail_revalidation_blocks_outdated_floor_price_on_acceptance(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Bug 3: Accepting deal is blocked if floor price was updated above agreed price after offer was quoted."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    mock_llm = MockDecisionLLMClient([
        # R1: Seller counters at 450
        NegotiationDecision(counter_price=450.0, justification="Counter 450", internal_reasoning="", should_accept=False, needs_approval=False),
        # R2: Buyer accepts seller's 450
        NegotiationDecision(counter_price=450.0, justification="Agreed at 450", internal_reasoning="", should_accept=True, needs_approval=False),
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_floor_test", sku_code="SKU-1042", quantity=50)

    # R1: Buyer proposes 400, seller counters 450
    service.handle_buyer_move(session.id, BuyerMove(quantity=50, offered_price=400.0))

    # Merchant updates floor price in repository to 480 (above the quoted 450)
    updated_policy = dict(sample_pricing_policy)
    updated_policy["floor_price"] = 480.0
    repo.save_pricing_policy(updated_policy)

    # R2: Buyer attempts to accept seller's previous 450 offer -> re-validation must reject
    with pytest.raises(ValueError, match="Price no longer valid"):
        service.accept_offer(session.id, buyer_id="buyer_floor_test")


def test_audit_logs_nullable_event_id_for_lifecycle_transitions(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Bug 4: Lifecycle events without offer events (e.g. SESSION_CREATED, BUYER_DECLINED) have event_id=None."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(counter_price=480.0, justification="Offer", internal_reasoning="", should_accept=False, needs_approval=False),
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(buyer_id="buyer_decliner", sku_code="SKU-1042", quantity=50)

    # First round move
    service.handle_buyer_move(session.id, BuyerMove(quantity=50, offered_price=400.0))

    # Buyer walks / declines
    service.decline_offer(session.id, buyer_id="buyer_decliner")

    logs = repo.get_audit_logs(session.id)
    # SESSION_CREATED and BUYER_DECLINED should have event_id=None
    created_log = next(log for log in logs if log["snapshot_data"].get("event_type") == "SESSION_CREATED")
    assert created_log["event_id"] is None

    declined_log = next(log for log in logs if log["snapshot_data"].get("event_type") == "BUYER_DECLINED")
    assert declined_log["event_id"] is None

    # Entire chain must remain valid
    for i in range(1, len(logs)):
        assert logs[i]["previous_hash"] == logs[i - 1]["current_hash"]


def test_create_session_with_custom_quantity(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Bug 6: create_session accepts and persists quantity."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    service = NegotiationSessionService(repo=repo)
    session = service.create_session(buyer_id="buyer_qty", sku_code="SKU-1042", quantity=350)

    assert session.quantity == 350
    persisted = repo.get_session(session.id)
    assert persisted.quantity == 350


def test_buyer_accepts_routing_rejects_invalid_states(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """Bug 7: Cannot accept offer from INITIATED or non-negotiating states."""
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    service = NegotiationSessionService(repo=repo)
    session = service.create_session(buyer_id="buyer_invalid_acc", sku_code="SKU-1042")

    with pytest.raises(Exception):
        service.accept_offer(session.id, buyer_id="buyer_invalid_acc")


# ---------------------------------------------------------------------------
# 7. Decision 3: PENDING_APPROVAL 30-Minute Timeout Auto-Reject
# ---------------------------------------------------------------------------

def test_pending_approval_timeout_auto_rejects_session(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """
    Decision 3: If merchant does not respond within 30 minutes,
    PENDING_APPROVAL auto-transitions to REJECTED on next read.
    """
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    # LLM escalates to merchant approval (price in approval band)
    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(
            counter_price=415.0,
            justification="Escalating for merchant review",
            internal_reasoning="Price in approval band",
            should_accept=False,
            needs_approval=True,
        )
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(
        buyer_id="buyer_timeout_test",
        sku_code="SKU-1042",
        quantity=100,
    )

    # Push session to PENDING_APPROVAL
    move = BuyerMove(
        quantity=100,
        offered_price=415.0,
        buyer_message="Best I can do",
        accept_last_offer=False,
    )
    response = service.handle_buyer_move(session.id, move)
    assert response.status == "PENDING_APPROVAL"

    # Simulate time passing: set expires_at to 31 minutes ago
    stored_session = repo.get_session(session.id)
    stored_session.expires_at = datetime.now(timezone.utc) - timedelta(minutes=31)
    repo.update_session(stored_session)

    # Act: fetch session triggers lazy expiry check
    fetched = service.get_session(session.id)

    # Assert: auto-rejected
    assert fetched.status == "REJECTED"

    # Assert: audit log recorded the timeout event
    audit_logs = repo.get_audit_logs(session.id)
    timeout_log = [
        log for log in audit_logs
        if log["snapshot_data"].get("event_type") == "APPROVAL_TIMEOUT_REJECTED"
    ]
    assert len(timeout_log) == 1
    assert "did not respond" in timeout_log[0]["snapshot_data"]["reason"]

    # Assert: merchant_approvals row updated to TIMEOUT
    approval = repo.get_merchant_approval(session.id)
    assert approval is not None
    assert approval["status"] == "TIMEOUT"


def test_pending_approval_within_window_is_not_rejected(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """
    Negative test: PENDING_APPROVAL within the 30-minute window
    should NOT be auto-rejected.
    """
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(
            counter_price=415.0,
            justification="Escalating",
            internal_reasoning="In approval band",
            should_accept=False,
            needs_approval=True,
        )
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(
        buyer_id="buyer_still_waiting",
        sku_code="SKU-1042",
        quantity=100,
    )

    move = BuyerMove(
        quantity=100,
        offered_price=415.0,
        buyer_message="Waiting for your merchant",
        accept_last_offer=False,
    )
    response = service.handle_buyer_move(session.id, move)
    assert response.status == "PENDING_APPROVAL"

    # Do NOT manipulate expires_at — it's still within window

    # Act: fetch session
    fetched = service.get_session(session.id)

    # Assert: still PENDING_APPROVAL, not auto-rejected
    assert fetched.status == "PENDING_APPROVAL"


def test_merchant_responds_before_timeout_is_not_affected(
    sample_catalog_sku: Dict[str, Any],
    sample_pricing_policy: Dict[str, Any],
) -> None:
    """
    If merchant approves before the 30-minute timeout,
    session should transition to AGREED normally.
    """
    repo = InMemorySessionRepository()
    repo.save_catalog_sku(sample_catalog_sku)
    repo.save_pricing_policy(sample_pricing_policy)

    mock_llm = MockDecisionLLMClient([
        NegotiationDecision(
            counter_price=415.0,
            justification="Please check with your merchant",
            internal_reasoning="In approval band",
            should_accept=False,
            needs_approval=True,
        )
    ])

    service = NegotiationSessionService(repo=repo, llm_client=mock_llm)
    session = service.create_session(
        buyer_id="buyer_merchant_fast",
        sku_code="SKU-1042",
        quantity=100,
    )

    move = BuyerMove(
        quantity=100,
        offered_price=415.0,
        buyer_message="Please check with your merchant",
        accept_last_offer=False,
    )
    response = service.handle_buyer_move(session.id, move)
    assert response.status == "PENDING_APPROVAL"

    # Merchant approves within window (expires_at still in future)
    decision = MerchantDecisionRequest(
        decision="approve",
        merchant_notes="Approved — good customer",
    )
    result = service.handle_merchant_decision(session.id, decision)

    # Assert: AGREED, not affected by timeout logic
    assert result.status == "AGREED"
    assert result.payment_link_url is not None


