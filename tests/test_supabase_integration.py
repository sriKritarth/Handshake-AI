"""Live integration tests against Supabase Postgres database."""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
import pytest
import dotenv

dotenv.load_dotenv()

# Ensure backend/ is in sys.path
BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..", "backend")
sys.path.insert(0, os.path.abspath(BACKEND_DIR))

from session.db import (
    OfferEventRecord,
    SessionRecord,
    SupabaseSessionRepository,
)
from session.audit import AuditService


# Skip if Supabase credentials are not in environment
has_supabase = bool(os.environ.get("SUPABASE_URL") and (os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_PUBLISHABLE_KEY")))


@pytest.mark.skipif(not has_supabase, reason="Supabase credentials not available in environment.")
class TestSupabaseIntegration:
    """Live integration tests directly verifying Supabase queries, inserts, and updates."""

    @pytest.fixture
    def repo(self) -> SupabaseSessionRepository:
        return SupabaseSessionRepository()

    def test_fetch_catalog_sku_and_pricing_policy(self, repo: SupabaseSessionRepository) -> None:
        """Verify reading catalog SKUs and their associated pricing policies from Supabase."""
        sku = repo.get_catalog_sku_by_code("TSH-PREM-001")
        assert sku is not None
        assert sku["sku_code"] == "TSH-PREM-001"
        assert sku["name"] == "Premium Heavyweight Cotton Tee"
        assert sku["base_price"] == 1499.0

        policy = repo.get_pricing_policy_by_sku_id(sku["id"])
        assert policy is not None
        assert policy["sku_code"] == "TSH-PREM-001"
        assert policy["floor_price"] == 850.0
        assert policy["cost_price"] == 600.0

    def test_session_lifecycle_crud_on_supabase(self, repo: SupabaseSessionRepository) -> None:
        """Verify creating, reading, updating, and recording events on Supabase."""
        sku = repo.get_catalog_sku_by_code("TSH-PREM-001")
        assert sku is not None

        test_session_id = str(uuid.uuid4())
        session = SessionRecord(
            id=test_session_id,
            sku_id=sku["id"],
            buyer_id="integration_test_buyer",
            channel="CHAT",
            status="INITIATED",
            current_round=0,
        )

        # 1. Create session
        created = repo.create_session(session)
        assert created.id == test_session_id

        # 2. Get session
        fetched = repo.get_session(test_session_id)
        assert fetched is not None
        assert fetched.id == test_session_id
        assert fetched.status == "INITIATED"
        assert fetched.buyer_id == "integration_test_buyer"

        # 3. Update session status and round
        fetched.status = "IN_PROGRESS"
        fetched.current_round = 1
        repo.update_session(fetched)

        refetched = repo.get_session(test_session_id)
        assert refetched is not None
        assert refetched.status == "IN_PROGRESS"
        assert refetched.current_round == 1

        # 4. Record offer events
        event = OfferEventRecord(
            session_id=test_session_id,
            round_number=1,
            sender="BUYER",
            quantity=50,
            proposed_price=1100.0,
            guardrail_clamped_price=1100.0,
            public_justification="Bulk order test",
        )
        repo.record_offer_event(event)

        events = repo.get_offer_events(test_session_id)
        assert len(events) >= 1
        assert events[0]["proposed_price"] == 1100.0
        assert events[0]["sender"] == "BUYER"

        # 5. Record merchant approval
        approval = repo.record_merchant_approval(
            session_id=test_session_id,
            requested_price=1050.0,
            status="PENDING",
            notes="Testing escalation",
        )
        assert approval["status"] == "PENDING"

        # 6. Update merchant approval
        updated_appr = repo.update_merchant_approval(
            session_id=test_session_id,
            status="APPROVED",
            notes="Approved by admin",
        )
        assert updated_appr is not None
        assert updated_appr["status"] == "APPROVED"

        # 7. Record Razorpay order
        rzp = repo.record_razorpay_order(
            session_id=test_session_id,
            razorpay_order_id=f"order_{uuid.uuid4().hex[:10]}",
            payment_link_id=f"plink_{uuid.uuid4().hex[:10]}",
            short_url="https://rzp.io/i/test1234",
            amount=55000.0,
        )
        assert rzp["short_url"] == "https://rzp.io/i/test1234"

        # 8. Cryptographic audit log chaining (event_id references offer_events.id)
        log1 = AuditService.create_log_entry(
            session_id=test_session_id,
            event_type="SESSION_CREATED",
            snapshot_data={"status": "INITIATED"},
            previous_hash=None,
            event_id=event.id,
        )
        repo.append_audit_log(log1)

        log2 = AuditService.create_log_entry(
            session_id=test_session_id,
            event_type="ROUND_EVALUATED",
            snapshot_data={"status": "IN_PROGRESS", "round": 1},
            previous_hash=log1["current_hash"],
            event_id=event.id,
        )
        repo.append_audit_log(log2)

        audit_logs = repo.get_audit_logs(test_session_id)
        assert len(audit_logs) >= 2
        assert audit_logs[1]["previous_hash"] == audit_logs[0]["current_hash"]
