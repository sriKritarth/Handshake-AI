"""Database access layer and repositories for Negotiation Sessions and related tables."""
from __future__ import annotations

import os
import uuid
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
import httpx
from supabase import create_client, Client, ClientOptions


class SessionRecord(BaseModel):
    """Internal model bound to negotiation_sessions table."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    sku_id: str
    buyer_id: str
    channel: str = "CHAT"
    quantity: int = 1
    status: str = "INITIATED"
    current_round: int = 0
    final_agreed_price: Optional[float] = None
    final_offer_price: Optional[float] = None
    pending_approval_price: Optional[float] = None
    expires_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class OfferEventRecord(BaseModel):
    """Model bound to offer_events table."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    round_number: int
    sender: str  # 'buyer' | 'seller_ai' | 'merchant'
    quantity: int = 1
    proposed_price: float
    guardrail_clamped_price: float
    is_rule_passed: bool = True
    passed_rules: Optional[List[str]] = None
    violated_rules: Optional[List[str]] = None
    rule_reason: Optional[str] = None
    public_justification: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class BaseSessionRepository(ABC):
    """Abstract interface for session storage."""

    @abstractmethod
    def get_catalog_sku_by_code(self, sku_code: str) -> Optional[Dict[str, Any]]:
        pass

    @abstractmethod
    def get_pricing_policy_by_sku_id(self, sku_id: str) -> Optional[Dict[str, Any]]:
        pass

    @abstractmethod
    def create_session(self, session: SessionRecord) -> SessionRecord:
        pass

    @abstractmethod
    def get_session(self, session_id: str) -> Optional[SessionRecord]:
        pass

    @abstractmethod
    def update_session(self, session: SessionRecord) -> SessionRecord:
        pass

    @abstractmethod
    def record_offer_event(self, event: OfferEventRecord) -> OfferEventRecord:
        pass

    @abstractmethod
    def get_offer_events(self, session_id: str) -> List[Dict[str, Any]]:
        pass

    @abstractmethod
    def record_merchant_approval(
        self, session_id: str, requested_price: float, status: str = "PENDING", notes: Optional[str] = None
    ) -> Dict[str, Any]:
        pass

    @abstractmethod
    def update_merchant_approval(
        self, session_id: str, status: str, notes: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        pass

    @abstractmethod
    def record_razorpay_order(
        self, session_id: str, razorpay_order_id: str, payment_link_id: str, short_url: str, amount: float
    ) -> Dict[str, Any]:
        pass

    @abstractmethod
    def append_audit_log(self, log_entry: Dict[str, Any]) -> None:
        pass

    @abstractmethod
    def get_audit_logs(self, session_id: str) -> List[Dict[str, Any]]:
        pass


class InMemorySessionRepository(BaseSessionRepository):
    """Fast in-memory repository for unit testing."""

    def __init__(self) -> None:
        self.catalog_skus: Dict[str, Dict[str, Any]] = {}
        self.pricing_policies: Dict[str, Dict[str, Any]] = {}
        self.sessions: Dict[str, SessionRecord] = {}
        self.offer_events: Dict[str, List[OfferEventRecord]] = {}
        self.merchant_approvals: Dict[str, List[Dict[str, Any]]] = {}
        self.razorpay_orders: Dict[str, Dict[str, Any]] = {}
        self.audit_logs: Dict[str, List[Dict[str, Any]]] = {}

    def save_catalog_sku(self, sku: Dict[str, Any]) -> None:
        sku_code = sku.get("sku_code", sku.get("id"))
        self.catalog_skus[sku_code] = dict(sku)
        self.catalog_skus[sku.get("id")] = dict(sku)

    def save_pricing_policy(self, policy: Dict[str, Any]) -> None:
        self.pricing_policies[policy.get("sku_id")] = dict(policy)
        self.pricing_policies[policy.get("sku_code")] = dict(policy)

    def get_catalog_sku_by_code(self, sku_code: str) -> Optional[Dict[str, Any]]:
        return self.catalog_skus.get(sku_code)

    def get_pricing_policy_by_sku_id(self, sku_id: str) -> Optional[Dict[str, Any]]:
        return self.pricing_policies.get(sku_id)

    def create_session(self, session: SessionRecord) -> SessionRecord:
        self.sessions[session.id] = session
        return session

    def get_session(self, session_id: str) -> Optional[SessionRecord]:
        return self.sessions.get(session_id)

    def update_session(self, session: SessionRecord) -> SessionRecord:
        session.updated_at = datetime.now(timezone.utc)
        self.sessions[session.id] = session
        return session

    def record_offer_event(self, event: OfferEventRecord) -> OfferEventRecord:
        self.offer_events.setdefault(event.session_id, []).append(event)
        return event

    def get_offer_events(self, session_id: str) -> List[Dict[str, Any]]:
        return [ev.model_dump() for ev in self.offer_events.get(session_id, [])]

    def record_merchant_approval(
        self, session_id: str, requested_price: float, status: str = "PENDING", notes: Optional[str] = None
    ) -> Dict[str, Any]:
        entry = {
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "requested_price": requested_price,
            "status": status,
            "merchant_notes": notes,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "responded_at": None,
        }
        self.merchant_approvals.setdefault(session_id, []).append(entry)
        return entry

    def update_merchant_approval(
        self, session_id: str, status: str, notes: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        entries = self.merchant_approvals.get(session_id, [])
        if entries:
            latest = entries[-1]
            latest["status"] = status
            latest["merchant_notes"] = notes or latest.get("merchant_notes")
            latest["responded_at"] = datetime.now(timezone.utc).isoformat()
            return latest
        return None

    def record_razorpay_order(
        self, session_id: str, razorpay_order_id: str, payment_link_id: str, short_url: str, amount: float
    ) -> Dict[str, Any]:
        order = {
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "razorpay_order_id": razorpay_order_id,
            "razorpay_payment_link_id": payment_link_id,
            "short_url": short_url,
            "amount": amount,
            "status": "CREATED",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        self.razorpay_orders[session_id] = order
        return order

    def append_audit_log(self, log_entry: Dict[str, Any]) -> None:
        self.audit_logs.setdefault(log_entry["session_id"], []).append(log_entry)

    def get_audit_logs(self, session_id: str) -> List[Dict[str, Any]]:
        return self.audit_logs.get(session_id, [])

    def get_merchant_approval(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Return the latest merchant_approvals row for the session (test helper)."""
        entries = self.merchant_approvals.get(session_id, [])
        return entries[-1] if entries else None




class SupabaseSessionRepository(BaseSessionRepository):
    """Postgres repository accessing Supabase tables via postgrest / supabase-py client."""

    def __init__(
        self,
        supabase_url: Optional[str] = None,
        supabase_key: Optional[str] = None,
    ) -> None:
        url = supabase_url or os.environ.get("SUPABASE_URL", "")
        key = supabase_key or os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
        if not url or not key:
            raise ValueError("SUPABASE_URL and SUPABASE_SECRET_KEY / SUPABASE_PUBLISHABLE_KEY must be provided.")
        self.client: Client = create_client(url, key, options=ClientOptions(httpx_client=httpx.Client()))

    def _is_valid_uuid(self, val: str) -> bool:
        try:
            uuid.UUID(str(val))
            return True
        except ValueError:
            return False

    def get_catalog_sku_by_code(self, sku_code: str) -> Optional[Dict[str, Any]]:
        if self._is_valid_uuid(sku_code):
            res = self.client.table("catalog_skus").select("*").eq("id", sku_code).execute()
            if res.data:
                return res.data[0]
        res = self.client.table("catalog_skus").select("*").eq("sku_code", sku_code).execute()
        return res.data[0] if res.data else None

    def get_pricing_policy_by_sku_id(self, sku_id: str) -> Optional[Dict[str, Any]]:
        if self._is_valid_uuid(sku_id):
            res = self.client.table("pricing_policies").select("*").eq("sku_id", sku_id).execute()
            if res.data:
                return res.data[0]
        res = self.client.table("pricing_policies").select("*").eq("sku_code", sku_id).execute()
        return res.data[0] if res.data else None

    def create_session(self, session: SessionRecord) -> SessionRecord:
        payload = {
            "id": session.id,
            "sku_id": session.sku_id,
            "buyer_id": session.buyer_id,
            "channel": session.channel,
            "status": session.status,
            "current_round": session.current_round,
            "final_agreed_price": session.final_agreed_price,
            "expires_at": session.expires_at.isoformat() if session.expires_at else None,
        }
        res = self.client.table("negotiation_sessions").insert(payload).execute()
        if res.data:
            return session
        raise RuntimeError("Failed to create negotiation session in Supabase.")

    def get_session(self, session_id: str) -> Optional[SessionRecord]:
        res = self.client.table("negotiation_sessions").select("*").eq("id", session_id).execute()
        if not res.data:
            return None
        row = res.data[0]
        exp = datetime.fromisoformat(row["expires_at"]) if row.get("expires_at") else None
        return SessionRecord(
            id=row["id"],
            sku_id=row["sku_id"],
            buyer_id=row["buyer_id"],
            channel=row.get("channel", "CHAT"),
            quantity=row.get("quantity", 1),
            status=row["status"],
            current_round=row["current_round"],
            final_agreed_price=row.get("final_agreed_price"),
            expires_at=exp,
        )

    def update_session(self, session: SessionRecord) -> SessionRecord:
        payload = {
            "status": session.status,
            "current_round": session.current_round,
            "final_agreed_price": session.final_agreed_price,
            "expires_at": session.expires_at.isoformat() if session.expires_at else None,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self.client.table("negotiation_sessions").update(payload).eq("id", session.id).execute()
        return session

    def record_offer_event(self, event: OfferEventRecord) -> OfferEventRecord:
        payload = {
            "id": event.id,
            "session_id": event.session_id,
            "round_number": event.round_number,
            "sender": event.sender,
            "quantity": event.quantity,
            "proposed_price": event.proposed_price,
            "guardrail_clamped_price": event.guardrail_clamped_price,
            "is_rule_passed": event.is_rule_passed,
            "passed_rules": event.passed_rules or [],
            "violated_rules": event.violated_rules or [],
            "rule_reason": event.rule_reason or "",
            "public_justification": event.public_justification or "",
        }
        self.client.table("offer_events").insert(payload).execute()
        return event

    def get_offer_events(self, session_id: str) -> List[Dict[str, Any]]:
        res = self.client.table("offer_events").select("*").eq("session_id", session_id).order("round_number").execute()
        return res.data or []

    def record_merchant_approval(
        self, session_id: str, requested_price: float, status: str = "PENDING", notes: Optional[str] = None
    ) -> Dict[str, Any]:
        payload = {
            "session_id": session_id,
            "requested_price": requested_price,
            "status": status,
            "merchant_notes": notes,
        }
        res = self.client.table("merchant_approvals").insert(payload).execute()
        return res.data[0] if res.data else payload

    def update_merchant_approval(
        self, session_id: str, status: str, notes: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        payload = {
            "status": status,
            "merchant_notes": notes,
            "responded_at": datetime.now(timezone.utc).isoformat(),
        }
        res = self.client.table("merchant_approvals").update(payload).eq("session_id", session_id).execute()
        return res.data[0] if res.data else None

    def record_razorpay_order(
        self, session_id: str, razorpay_order_id: str, payment_link_id: str, short_url: str, amount: float
    ) -> Dict[str, Any]:
        payload = {
            "session_id": session_id,
            "razorpay_order_id": razorpay_order_id,
            "razorpay_payment_link_id": payment_link_id,
            "short_url": short_url,
            "amount": amount,
            "status": "CREATED",
        }
        res = self.client.table("razorpay_orders").insert(payload).execute()
        return res.data[0] if res.data else payload

    def append_audit_log(self, log_entry: Dict[str, Any]) -> None:
        self.client.table("audit_logs").insert(log_entry).execute()

    def get_audit_logs(self, session_id: str) -> List[Dict[str, Any]]:
        res = self.client.table("audit_logs").select("*").eq("session_id", session_id).order("logged_at").execute()
        return res.data or []
