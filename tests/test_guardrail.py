"""
tests/test_guardrail.py

Full pytest test suite for the GuardrailEngine layer.

Coverage:
  - Offer model validation
  - FloorPriceRule
  - MarginFloorRule
  - QuantityTierRule
  - InventoryDiscretionRule
  - RoundLimitRule
  - MaxDiscountRule
  - GuardrailEngine integration (waterfall, jailbreak, merchant-approval, round-limit)
"""

import sys
import os

# ---------------------------------------------------------------------------
# Path setup — allow imports from backend/ without installing as a package
# ---------------------------------------------------------------------------
BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..", "backend")
sys.path.insert(0, os.path.abspath(BACKEND_DIR))

import pytest
from datetime import date

from guardrail.base import Offer, RuleResult
from guardrail.engine import GuardrailEngine, GuardrailResult
from guardrail.rules.floor_price_rule import FloorPriceRule
from guardrail.rules.inventory_discretion_rule import InventoryDiscretionRule
from guardrail.rules.margin_floor_rule import MarginFloorRule
from guardrail.rules.max_discount_rule import MaxDiscountRule
from guardrail.rules.quantity_tier_rule import QuantityTierRule
from guardrail.rules.round_limit_rule import RoundLimitRule
from models.pricing_policy import InventoryDiscretion, PricingPolicy, QuantityTier


# ===========================================================================
# Shared fixtures
# ===========================================================================

@pytest.fixture
def standard_policy() -> PricingPolicy:
    """A realistic policy for TSH-PREM-001 (T-shirt, high margin)."""
    return PricingPolicy(
        sku="TSH-PREM-001",
        cost_price=220.0,
        floor_price=260.0,
        margin_floor_pct=15.0,        # min price = 220 × 1.15 = 253.00
        quantity_tiers=[
            QuantityTier(min_qty=1,   max_qty=49,  discount_pct=0.0),
            QuantityTier(min_qty=50,  max_qty=199, discount_pct=6.0),
            QuantityTier(min_qty=200, max_qty=499, discount_pct=10.0),
            QuantityTier(min_qty=500, max_qty=None, discount_pct=14.0),
        ],
        inventory_age_days=12,
        expiry_date=None,
        inventory_discretion=InventoryDiscretion(
            age_threshold_days=90,
            extra_discount_pct=4.0,
        ),
        urgency_flex_pct=2.0,
        max_total_discount_pct=20.0,
    )


@pytest.fixture
def aged_policy() -> PricingPolicy:
    """A policy where inventory is older than the age threshold (triggers discretion)."""
    return PricingPolicy(
        sku="JAC-LEATH-001",
        cost_price=3600.0,
        floor_price=4200.0,
        margin_floor_pct=15.0,
        quantity_tiers=[
            QuantityTier(min_qty=1,  max_qty=9,   discount_pct=0.0),
            QuantityTier(min_qty=10, max_qty=49,  discount_pct=10.0),
            QuantityTier(min_qty=50, max_qty=None, discount_pct=18.0),
        ],
        inventory_age_days=120,       # > age_threshold_days=90 → discretion triggers
        expiry_date=None,
        inventory_discretion=InventoryDiscretion(
            age_threshold_days=90,
            extra_discount_pct=5.0,   # extra_floor = 4200 × 0.95 = 3990.0
        ),
        urgency_flex_pct=3.0,
        max_total_discount_pct=25.0,
    )


def make_offer(
    proposed_price: float,
    list_price: float = 499.0,
    quantity: int = 10,
    round_number: int = 0,
    urgency: str = "normal",
    bundle_skus: list[str] | None = None,
) -> Offer:
    """Helper to build an Offer with sensible defaults."""
    return Offer(
        sku="TSH-PREM-001",
        proposed_price=proposed_price,
        list_price=list_price,
        quantity=quantity,
        round_number=round_number,
        urgency=urgency,
        bundle_skus=bundle_skus or [],
    )


# ===========================================================================
# Offer model validation
# ===========================================================================

class TestOfferModel:
    def test_valid_offer_construction(self):
        offer = make_offer(proposed_price=400.0)
        assert offer.proposed_price == 400.0
        assert offer.list_price == 499.0
        assert offer.quantity == 10
        assert offer.round_number == 0
        assert offer.urgency == "normal"
        assert offer.bundle_skus == []

    def test_proposed_price_must_be_positive(self):
        with pytest.raises(Exception):   # pydantic ValidationError
            Offer(
                sku="X",
                proposed_price=0.0,     # gt=0 fails
                list_price=499.0,
                quantity=10,
                round_number=0,
                urgency="normal",
            )

    def test_quantity_must_be_positive(self):
        with pytest.raises(Exception):
            make_offer(proposed_price=400.0)
            Offer(
                sku="X",
                proposed_price=400.0,
                list_price=499.0,
                quantity=0,             # gt=0 fails
                round_number=0,
                urgency="normal",
            )

    def test_urgency_is_literal(self):
        with pytest.raises(Exception):
            Offer(
                sku="X",
                proposed_price=400.0,
                list_price=499.0,
                quantity=10,
                round_number=0,
                urgency="critical",     # not in Literal["high", "normal"]
            )


# ===========================================================================
# RuleResult dataclass
# ===========================================================================

class TestRuleResult:
    def test_effective_price_returns_adjusted_when_set(self):
        r = RuleResult(
            passed=False,
            rule_name="floor_price",
            original_price=200.0,
            adjusted_price=260.0,
            reason="below_floor_price",
        )
        assert r.effective_price == 260.0

    def test_effective_price_returns_original_when_no_adjustment(self):
        r = RuleResult(
            passed=True,
            rule_name="floor_price",
            original_price=350.0,
            adjusted_price=None,
            reason="ok",
        )
        assert r.effective_price == 350.0

    def test_requires_merchant_approval_defaults_false(self):
        r = RuleResult(
            passed=True, rule_name="test", original_price=100.0,
            adjusted_price=None, reason="ok",
        )
        assert r.requires_merchant_approval is False


# ===========================================================================
# FloorPriceRule
# ===========================================================================

class TestFloorPriceRule:
    def setup_method(self):
        self.rule = FloorPriceRule()

    def test_below_floor_is_clamped(self, standard_policy):
        offer = make_offer(proposed_price=100.0)    # floor is 260
        result = self.rule.evaluate(offer, standard_policy)
        assert result.passed is False
        assert result.adjusted_price == 260.0
        assert result.reason == "below_floor_price"
        assert result.rule_name == "floor_price"

    def test_at_floor_passes(self, standard_policy):
        offer = make_offer(proposed_price=260.0)
        result = self.rule.evaluate(offer, standard_policy)
        assert result.passed is True
        assert result.adjusted_price is None

    def test_above_floor_passes(self, standard_policy):
        offer = make_offer(proposed_price=350.0)
        result = self.rule.evaluate(offer, standard_policy)
        assert result.passed is True
        assert result.adjusted_price is None

    def test_jailbreak_zero_price_clamped(self, standard_policy):
        """Simulates jailbreak attempt: proposed_price must be > 0 (Pydantic catches 0),
        so we test the nearest-to-zero valid case."""
        offer = make_offer(proposed_price=0.01)
        result = self.rule.evaluate(offer, standard_policy)
        assert result.passed is False
        assert result.adjusted_price == 260.0


# ===========================================================================
# MarginFloorRule
# ===========================================================================

class TestMarginFloorRule:
    """standard_policy: cost=220, margin_floor_pct=15 → min_price = 253.00"""

    def setup_method(self):
        self.rule = MarginFloorRule()

    def test_below_margin_is_clamped(self, standard_policy):
        offer = make_offer(proposed_price=250.0)    # < 253
        result = self.rule.evaluate(offer, standard_policy)
        assert result.passed is False
        assert result.adjusted_price == 253.0
        assert result.reason == "below_margin_floor"

    def test_at_margin_floor_passes(self, standard_policy):
        offer = make_offer(proposed_price=253.0)
        result = self.rule.evaluate(offer, standard_policy)
        assert result.passed is True
        assert result.adjusted_price is None

    def test_above_margin_floor_passes(self, standard_policy):
        offer = make_offer(proposed_price=350.0)
        result = self.rule.evaluate(offer, standard_policy)
        assert result.passed is True

    def test_clamped_price_rounded_to_2dp(self, standard_policy):
        """margin_floor_pct=15%, cost=220 → exact = 253.000 (already clean)."""
        result = self.rule.evaluate(make_offer(100.0), standard_policy)
        assert result.adjusted_price == 253.00


# ===========================================================================
# QuantityTierRule
# ===========================================================================

class TestQuantityTierRule:
    """standard_policy tiers: 1–49: 0%, 50–199: 6%, 200–499: 10%, 500+: 14%
       list_price in offers = 499.0 (fixture default).
    """

    def setup_method(self):
        self.rule = QuantityTierRule()

    def _offer(self, qty: int, proposed: float) -> Offer:
        return make_offer(proposed_price=proposed, list_price=499.0, quantity=qty)

    def test_tier_0pct_qty_1(self, standard_policy):
        result = self.rule.evaluate(self._offer(1, 499.0), standard_policy)
        # No discount tier — proposed is exactly list price, no adjustment
        assert result.passed is True
        assert result.adjusted_price is None

    def test_tier_6pct_qty_50(self, standard_policy):
        """qty=50 → 6% tier → tier_price = 499 × 0.94 = 469.06"""
        result = self.rule.evaluate(self._offer(50, 499.0), standard_policy)
        assert result.passed is True
        assert result.adjusted_price == pytest.approx(469.06, abs=0.01)

    def test_tier_10pct_qty_200(self, standard_policy):
        """qty=200 → 10% tier → tier_price = 499 × 0.90 = 449.10"""
        result = self.rule.evaluate(self._offer(200, 499.0), standard_policy)
        assert result.passed is True
        assert result.adjusted_price == pytest.approx(449.10, abs=0.01)

    def test_tier_14pct_qty_500(self, standard_policy):
        """qty=500 → 14% tier → tier_price = 499 × 0.86 = 429.14"""
        result = self.rule.evaluate(self._offer(500, 499.0), standard_policy)
        assert result.adjusted_price == pytest.approx(429.14, abs=0.01)

    def test_buyer_proposes_below_tier_price_is_allowed(self, standard_policy):
        """Buyer proposes 400 for qty=50 (tier_price=469.06) — that's an even better
        deal for the buyer; the tier rule allows it (downstream rules will catch
        if it's too low)."""
        result = self.rule.evaluate(self._offer(50, 400.0), standard_policy)
        assert result.passed is True
        assert result.adjusted_price is None   # no adjustment — already below tier

    def test_edge_of_tier_boundary_49(self, standard_policy):
        """qty=49 → still 0% tier."""
        result = self.rule.evaluate(self._offer(49, 499.0), standard_policy)
        # 0% discount → tier_price = 499.0, proposed == tier_price → no adjustment
        assert result.adjusted_price is None

    def test_edge_of_tier_boundary_50(self, standard_policy):
        """qty=50 → first day of 6% tier."""
        result = self.rule.evaluate(self._offer(50, 499.0), standard_policy)
        assert result.adjusted_price == pytest.approx(469.06, abs=0.01)

    def test_no_tiers_defined_passes(self, standard_policy):
        """Policy with no tiers: rule should return no_tier_defined."""
        policy_no_tiers = standard_policy.model_copy(update={"quantity_tiers": []})
        result = self.rule.evaluate(self._offer(100, 499.0), policy_no_tiers)
        assert result.passed is True
        assert result.reason == "no_tier_defined"
        assert result.adjusted_price is None


# ===========================================================================
# InventoryDiscretionRule
# ===========================================================================

class TestInventoryDiscretionRule:
    """aged_policy: floor=4200, age=120 days, threshold=90, extra=5%
       → extra_floor = 4200 × 0.95 = 3990.0
    """

    def setup_method(self):
        self.rule = InventoryDiscretionRule()

    def _offer(self, proposed: float, qty: int = 5) -> Offer:
        return Offer(
            sku="JAC-LEATH-001",
            proposed_price=proposed,
            list_price=6500.0,
            quantity=qty,
            round_number=0,
            urgency="normal",
        )

    def test_aged_inventory_above_extra_floor_passes(self, aged_policy):
        result = self.rule.evaluate(self._offer(4000.0), aged_policy)
        assert result.passed is True
        assert result.reason == "aged_inventory_discretion_ok"
        assert result.adjusted_price is None

    def test_aged_inventory_at_extra_floor_passes(self, aged_policy):
        result = self.rule.evaluate(self._offer(3990.0), aged_policy)
        assert result.passed is True

    def test_aged_inventory_below_extra_floor_clamped(self, aged_policy):
        result = self.rule.evaluate(self._offer(3800.0), aged_policy)
        assert result.passed is False
        assert result.adjusted_price == pytest.approx(3990.0, abs=0.01)
        assert result.reason == "below_aged_inventory_floor"

    def test_fresh_inventory_rule_is_noop(self, standard_policy):
        """standard_policy.inventory_age_days=12 < threshold=90 → no discretion."""
        offer = Offer(
            sku="TSH-PREM-001",
            proposed_price=255.0,
            list_price=499.0,
            quantity=10,
            round_number=0,
            urgency="normal",
        )
        result = self.rule.evaluate(offer, standard_policy)
        assert result.passed is True
        assert result.reason == "inventory_not_aged"
        assert result.adjusted_price is None

    def test_no_discretion_configured_is_noop(self, standard_policy):
        policy_no_disc = standard_policy.model_copy(update={"inventory_discretion": None})
        offer = Offer(
            sku="TSH-PREM-001",
            proposed_price=200.0,
            list_price=499.0,
            quantity=10,
            round_number=0,
            urgency="normal",
        )
        result = self.rule.evaluate(offer, policy_no_disc)
        assert result.passed is True
        assert result.reason == "no_discretion_configured"


# ===========================================================================
# RoundLimitRule
# ===========================================================================

class TestRoundLimitRule:
    def test_within_rounds_passes(self, standard_policy):
        rule = RoundLimitRule(max_rounds=5)
        offer = make_offer(proposed_price=350.0, round_number=3)
        result = rule.evaluate(offer, standard_policy)
        assert result.passed is True
        assert result.reason == "ok"

    def test_at_max_rounds_flags_limit(self, standard_policy):
        rule = RoundLimitRule(max_rounds=5, last_approved_price=320.0)
        offer = make_offer(proposed_price=350.0, round_number=5)
        result = rule.evaluate(offer, standard_policy)
        assert result.passed is False
        assert result.reason == "round_limit_reached"
        assert result.adjusted_price == 320.0    # last approved price

    def test_past_max_rounds_also_flags(self, standard_policy):
        rule = RoundLimitRule(max_rounds=5, last_approved_price=300.0)
        offer = make_offer(proposed_price=350.0, round_number=7)
        result = rule.evaluate(offer, standard_policy)
        assert result.passed is False
        assert result.reason == "round_limit_reached"

    def test_set_last_approved_price(self, standard_policy):
        rule = RoundLimitRule(max_rounds=3)
        rule.set_last_approved_price(350.0)
        offer = make_offer(proposed_price=300.0, round_number=3)
        result = rule.evaluate(offer, standard_policy)
        assert result.adjusted_price == 350.0

    def test_last_approved_price_none_when_unset(self, standard_policy):
        rule = RoundLimitRule(max_rounds=2)
        offer = make_offer(proposed_price=300.0, round_number=2)
        result = rule.evaluate(offer, standard_policy)
        assert result.passed is False
        assert result.adjusted_price is None   # no prior rounds


# ===========================================================================
# MaxDiscountRule
# ===========================================================================

class TestMaxDiscountRule:
    """standard_policy.max_total_discount_pct = 20.0
       auto_approve_threshold = 80% of 20 = 16% (default).
       list_price = 499.0

       Zones:
         - ≤16% discount  → auto-approved  (price ≥ 499 × 0.84 = 419.16)
         - 16–20% discount → merchant approval (419.16 > price ≥ 499 × 0.80 = 399.20)
         - >20% discount   → hard cap clamp  (price < 399.20)
    """

    def setup_method(self):
        self.rule = MaxDiscountRule()   # auto_approve = 80% of max

    def _offer(self, proposed: float) -> Offer:
        return make_offer(proposed_price=proposed, list_price=499.0, quantity=10)

    def test_no_discount_is_auto_approved(self, standard_policy):
        result = self.rule.evaluate(self._offer(499.0), standard_policy)
        assert result.passed is True
        assert result.requires_merchant_approval is False
        assert result.reason == "ok"

    def test_within_auto_approve_zone(self, standard_policy):
        # 15% discount: price = 499 × 0.85 = 424.15 → ≤16% threshold → ok
        result = self.rule.evaluate(self._offer(424.15), standard_policy)
        assert result.passed is True
        assert result.requires_merchant_approval is False

    def test_in_merchant_approval_zone(self, standard_policy):
        # 18% discount: price = 499 × 0.82 = 409.18 → between 16–20%
        result = self.rule.evaluate(self._offer(409.18), standard_policy)
        assert result.passed is True
        assert result.requires_merchant_approval is True
        assert result.reason == "merchant_approval_required"

    def test_above_max_discount_is_clamped(self, standard_policy):
        # 25% discount: price = 499 × 0.75 = 374.25 → > 20% hard cap
        result = self.rule.evaluate(self._offer(374.25), standard_policy)
        assert result.passed is False
        assert result.requires_merchant_approval is True
        assert result.reason == "max_discount_exceeded"
        # clamped to 499 × (1 - 0.20) = 399.20
        assert result.adjusted_price == pytest.approx(399.20, abs=0.01)

    def test_explicit_auto_approve_threshold(self, standard_policy):
        rule = MaxDiscountRule(auto_approve_threshold_pct=10.0)
        # 12% discount → above explicit threshold of 10% → merchant approval
        price = 499.0 * 0.88  # = 439.12
        result = rule.evaluate(self._offer(price), standard_policy)
        assert result.requires_merchant_approval is True

    def test_at_exact_max_discount_boundary(self, standard_policy):
        # Exactly 20% discount = 499 × 0.80 = 399.20 → still soft gate (not hard cap)
        price = round(499.0 * 0.80, 2)
        result = self.rule.evaluate(self._offer(price), standard_policy)
        assert result.passed is True
        assert result.requires_merchant_approval is True   # in merchant zone


# ===========================================================================
# GuardrailEngine — integration tests
# ===========================================================================

class TestGuardrailEngine:
    """End-to-end waterfall tests using GuardrailEngine.default()."""

    def _engine(self, max_rounds: int = 5) -> GuardrailEngine:
        return GuardrailEngine.default(max_rounds=max_rounds)

    # --- Happy path ---

    def test_happy_path_returns_passed(self, standard_policy):
        """Reasonable offer at 10% discount, qty=10 (0% tier) — should pass all rules."""
        engine = self._engine()
        offer = Offer(
            sku="TSH-PREM-001",
            proposed_price=450.0,
            list_price=499.0,
            quantity=10,
            round_number=1,
            urgency="normal",
        )
        result = engine.evaluate(offer, standard_policy)
        assert result.passed is True
        assert result.requires_merchant_approval is False
        assert result.final_price == pytest.approx(450.0, abs=0.01)
        assert result.is_round_limit_final is False
        assert result.blocking_rule is None

    # --- Jailbreak simulation ---

    def test_jailbreak_minimum_price_is_clamped(self, standard_policy):
        """A near-zero proposed price must be clamped — cannot be bypassed by an LLM prompt.

        Waterfall interaction explanation:
          1. FloorPriceRule: 1.0 < floor(260) → clamps to 260. ✓
          2. MarginFloorRule: 260 >= margin_floor(253) → passes.
          3. InventoryDiscretionRule: age=12 < threshold=90 → no-op.
          4. QuantityTierRule: qty=10 → 0% tier, tier_price=499, proposed=260 < tier_price → no-op.
          5. MaxDiscountRule: (499-260)/499 = 47.9% > max(20%) → clamps to 499×0.80 = 399.2.

        So the final price is 399.2, not 260: the max-discount cap enforces a DIFFERENT
        floor (from list_price reference), which is higher than the absolute floor in this
        extreme case.  Both rules fire; the result is definitively blocked and flagged.
        The key guarantee: the buyer agent CANNOT get a 99% discount — the system clamps
        to the highest enforced lower bound.
        """
        engine = self._engine()
        offer = Offer(
            sku="TSH-PREM-001",
            proposed_price=1.0,       # effectively zero — gt=0 prevents actual 0
            list_price=499.0,
            quantity=10,
            round_number=0,
            urgency="normal",
        )
        result = engine.evaluate(offer, standard_policy)
        # Final price is max-discount-clamped: 499 × (1 − 0.20) = 399.20
        assert result.final_price == pytest.approx(399.20, abs=0.01)
        assert result.passed is False
        # First blocking rule in the waterfall is floor_price
        assert result.blocking_rule == "floor_price"
        # MaxDiscountRule also fires → merchant approval required
        assert result.requires_merchant_approval is True
        # Verify floor_price rule is present in audit trail with correct clamp
        floor_result = next(r for r in result.rule_results if r.rule_name == "floor_price")
        assert floor_result.adjusted_price == pytest.approx(260.0, abs=0.01)

    # --- Floor price enforcement ---

    def test_below_floor_is_blocked_and_clamped(self, standard_policy):
        engine = self._engine()
        offer = make_offer(proposed_price=200.0, list_price=499.0, quantity=5)
        result = engine.evaluate(offer, standard_policy)
        assert result.blocking_rule == "floor_price"
        assert result.final_price >= standard_policy.floor_price

    # --- Merchant approval path ---

    def test_discount_near_max_triggers_merchant_approval(self, standard_policy):
        """18% discount (between auto-approve threshold=16% and max=20%)."""
        engine = self._engine()
        price = round(499.0 * 0.82, 2)  # 18% discount → 409.18
        offer = Offer(
            sku="TSH-PREM-001",
            proposed_price=price,
            list_price=499.0,
            quantity=10,
            round_number=1,
            urgency="normal",
        )
        result = engine.evaluate(offer, standard_policy)
        assert result.requires_merchant_approval is True
        assert result.passed is True     # price is legal, just needs approval

    def test_above_max_discount_hard_cap_and_approval(self, standard_policy):
        """25% discount (above max_total_discount_pct=20%) → clamped + merchant."""
        engine = self._engine()
        offer = Offer(
            sku="TSH-PREM-001",
            proposed_price=374.0,   # ~25% off 499
            list_price=499.0,
            quantity=10,
            round_number=0,
            urgency="normal",
        )
        result = engine.evaluate(offer, standard_policy)
        assert result.passed is False
        assert result.requires_merchant_approval is True
        assert result.final_price >= standard_policy.floor_price
        assert result.final_price >= standard_policy.cost_price * 1.15   # margin respected

    # --- Round limit ---

    def test_round_limit_fires_and_returns_last_approved(self, standard_policy):
        """After max_rounds, engine returns is_round_limit_final=True."""
        engine = self._engine(max_rounds=3)

        # Simulate 3 previous rounds — first update last_approved_price
        good_offer = Offer(
            sku="TSH-PREM-001",
            proposed_price=440.0,
            list_price=499.0,
            quantity=10,
            round_number=1,
            urgency="normal",
        )
        engine.evaluate(good_offer, standard_policy)  # updates last_approved_price

        # Now submit round 3 (= max_rounds → should flag limit)
        final_offer = good_offer.model_copy(update={"round_number": 3})
        result = engine.evaluate(final_offer, standard_policy)
        assert result.is_round_limit_final is True
        assert result.blocking_rule == "round_limit"

    # --- Full audit trail ---

    def test_rule_results_contain_all_rules(self, standard_policy):
        """Happy path should produce a result from every rule."""
        engine = self._engine()
        offer = Offer(
            sku="TSH-PREM-001",
            proposed_price=450.0,
            list_price=499.0,
            quantity=10,
            round_number=0,
            urgency="normal",
        )
        result = engine.evaluate(offer, standard_policy)
        rule_names = [r.rule_name for r in result.rule_results]
        assert "round_limit" in rule_names
        assert "floor_price" in rule_names
        assert "margin_floor" in rule_names
        assert "inventory_discretion" in rule_names
        assert "quantity_tier" in rule_names
        assert "max_discount" in rule_names

    # --- Aged inventory integration ---

    def test_aged_inventory_allows_deeper_discount(self, aged_policy):
        """JAC-LEATH-001: aged stock, extra floor = 3990.

        Use a price that is within the max_total_discount_pct=25% cap:
          list_price=6500, max_discount=25% → min_price = 6500×0.75 = 4875
          proposed_price=5000 → discount = (6500-5000)/6500 = 23.1% < 25% → ok
          inventory_discretion: age=120 > threshold=90 → extra_floor=3990, 5000>3990 → ok
        """
        engine = self._engine()
        offer = Offer(
            sku="JAC-LEATH-001",
            proposed_price=5000.0,    # 23.1% discount — within 25% hard cap
            list_price=6500.0,
            quantity=5,
            round_number=0,
            urgency="normal",
        )
        result = engine.evaluate(offer, aged_policy)
        # Should pass all rules — 5000 > extra_floor(3990) and within max discount (25%)
        assert result.final_price == pytest.approx(5000.0, abs=1.0)
        assert result.passed is True
        # 23.1% discount > auto-approve threshold (80% of 25% = 20%) → merchant approval zone
        # The offer is LEGAL but above the auto-approve band — escalated, not blocked.
        assert result.requires_merchant_approval is True
        assert result.blocking_rule is None   # not blocked — only flagged

    def test_aged_inventory_deep_discount_below_max_cap_is_blocked(self, aged_policy):
        """A price of 4000 is 38.5% off 6500 — above the 25% hard cap.
        MaxDiscountRule should clamp it to 6500×0.75=4875 regardless of aged discretion.
        Aged discretion only widens the floor_price reference, not the list-price cap.
        """
        engine = self._engine()
        offer = Offer(
            sku="JAC-LEATH-001",
            proposed_price=4000.0,
            list_price=6500.0,
            quantity=5,
            round_number=0,
            urgency="normal",
        )
        result = engine.evaluate(offer, aged_policy)
        # MaxDiscountRule caps at 25%: 6500 × 0.75 = 4875
        assert result.final_price == pytest.approx(4875.0, abs=0.01)
        assert result.requires_merchant_approval is True

    # --- Default factory ---

    def test_default_engine_creates_correctly(self):
        engine = GuardrailEngine.default(max_rounds=7)
        assert len(engine._rules) == 6    # 6 rules in canonical order
