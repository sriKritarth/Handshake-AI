"""Session management and orchestration service for negotiation workflows."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from session.audit import AuditService
from session.db import (
    BaseSessionRepository,
    InMemorySessionRepository,
    OfferEventRecord,
    SessionRecord,
    SupabaseSessionRepository,
)
from session.fsm import InvalidStateTransitionError, NegotiationFSM
from session.guardrails import apply_post_llm_guardrails
from session.models import (
    BuyerMove,
    MerchantDecisionRequest,
    NegotiationDecision,
    SessionResponse,
)
from session.payment import RazorpayPaymentService
from session.prompts import (
    build_system_prompt,
    build_user_prompt,
    pick_prompt_template,
)


class DefaultGroqDecisionClient:
    """Production Groq LLM client utilizing Instructor for NegotiationDecision structured output."""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None) -> None:
        self.api_key = api_key or os.environ.get("GROQ_API_KEY", "")
        self.model = model or os.environ.get("GROQ_MODEL", "openai/gpt-oss-120b")
        self._client = None
        if self.api_key:
            try:
                import instructor
                from groq import Groq
                raw_client = Groq(api_key=self.api_key)
                self._client = instructor.from_groq(raw_client, mode=instructor.Mode.TOOLS)
            except Exception:
                self._client = None

    def get_seller_response(self, system_prompt: str, user_prompt: str) -> NegotiationDecision:
        if self._client is None:
            raise RuntimeError("Groq LLM client is not initialized or GROQ_API_KEY is missing.")

        return self._client.chat.completions.create(
            model=self.model,
            response_model=NegotiationDecision,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.3,
        )


class NegotiationSessionService:
    """Core domain service managing the entire lifecycle of negotiation sessions."""

    def __init__(
        self,
        repo: Optional[BaseSessionRepository] = None,
        llm_client: Optional[Any] = None,
        payment_service: Optional[RazorpayPaymentService] = None,
    ) -> None:
        if repo is not None:
            self.repo = repo
        else:
            if os.environ.get("SUPABASE_URL") and (os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_PUBLISHABLE_KEY")):
                self.repo = SupabaseSessionRepository()
            else:
                self.repo = InMemorySessionRepository()

        self.llm_client = llm_client or DefaultGroqDecisionClient()
        self.payment_service = payment_service or RazorpayPaymentService()

    def _append_audit(
        self,
        session_id: str,
        event_type: str,
        from_state: Optional[str],
        to_state: str,
        actor: str,
        details: Dict[str, Any],
        event_id: Optional[str] = None,
    ) -> None:
        """Helper to create and append a cryptographic hash-chained audit log."""
        existing_logs = self.repo.get_audit_logs(session_id)
        prev_hash = existing_logs[-1]["current_hash"] if existing_logs else None

        snapshot = {
            "from_state": from_state,
            "to_state": to_state,
            "actor": actor,
            **details,
        }
        entry = AuditService.create_log_entry(
            session_id=session_id,
            event_type=event_type,
            snapshot_data=snapshot,
            previous_hash=prev_hash,
            event_id=event_id,
        )
        self.repo.append_audit_log(entry)

    def _revalidate_acceptance(
        self,
        sku_id: str,
        quantity: int,
        agreed_price: float,
    ) -> None:
        """Re-validate accepted deal against fresh inventory and policy state."""
        fresh_sku = self.repo.get_catalog_sku_by_code(sku_id)
        if not fresh_sku:
            raise ValueError(f"SKU '{sku_id}' not found during acceptance re-validation.")

        fresh_policy = self.repo.get_pricing_policy_by_sku_id(fresh_sku["id"])
        if not fresh_policy:
            raise ValueError(f"Pricing policy for SKU '{sku_id}' not found during acceptance re-validation.")

        fresh_floor = float(fresh_policy.get("floor_price", 0.0))
        fresh_stock = int(fresh_sku.get("inventory_qty", 1000))

        if agreed_price < fresh_floor:
            raise ValueError(
                f"Price no longer valid — agreed price ₹{agreed_price:.2f} is below updated floor price ₹{fresh_floor:.2f}."
            )

        if fresh_stock < quantity:
            raise ValueError(
                f"Insufficient stock — requested {quantity} units but only {fresh_stock} units available."
            )

    def create_session(
        self,
        buyer_id: str,
        sku_code: str,
        channel: str = "CHAT",
        quantity: int = 1,
    ) -> SessionRecord:
        """Create a new negotiation session for a SKU in INITIATED state."""
        sku = self.repo.get_catalog_sku_by_code(sku_code)
        if not sku:
            raise ValueError(f"SKU '{sku_code}' not found in catalog.")

        session = SessionRecord(
            sku_id=sku["id"],
            buyer_id=buyer_id,
            channel=channel,
            quantity=quantity,
            status="INITIATED",
            current_round=0,
        )
        created = self.repo.create_session(session)
        self._append_audit(
            session_id=created.id,
            event_type="SESSION_CREATED",
            from_state=None,
            to_state="INITIATED",
            actor="system",
            details={"buyer_id": buyer_id, "sku_code": sku_code, "channel": channel, "quantity": quantity},
            event_id=None,
        )
        return created

    def get_session(self, session_id: str) -> SessionRecord:
        """Retrieve session with single-roundtrip lazy check-on-read for expiry."""
        session = self.repo.get_session(session_id)
        if not session:
            raise ValueError(f"Session '{session_id}' not found.")

        now_utc = datetime.now(timezone.utc)

        # Lazy check-on-read: evaluate expiry if session is in FINAL_OFFER
        if session.status == "FINAL_OFFER" and session.expires_at:
            if now_utc > session.expires_at:
                fsm = NegotiationFSM(session)
                fsm.lazy_expire()
                self.repo.update_session(session)
                self._append_audit(
                    session_id=session.id,
                    event_type="SESSION_EXPIRED",
                    from_state="FINAL_OFFER",
                    to_state="EXPIRED",
                    actor="system",
                    details={"expired_at": session.expires_at.isoformat(), "checked_at": now_utc.isoformat()},
                    event_id=None,
                )

        # Decision 3: lazy check-on-read for PENDING_APPROVAL 30-min timeout
        elif session.status == "PENDING_APPROVAL" and session.expires_at:
            if now_utc > session.expires_at:
                fsm = NegotiationFSM(session)
                fsm.approval_timeout()
                self.repo.update_session(session)
                self.repo.update_merchant_approval(
                    session_id=session.id,
                    status="TIMEOUT",
                    notes="Auto-rejected: merchant did not respond within 30-minute window",
                )
                self._append_audit(
                    session_id=session.id,
                    event_type="APPROVAL_TIMEOUT_REJECTED",
                    from_state="PENDING_APPROVAL",
                    to_state="REJECTED",
                    actor="system",
                    details={
                        "reason": "Merchant did not respond within 30-minute window",
                        "expired_at": session.expires_at.isoformat(),
                        "checked_at": now_utc.isoformat(),
                    },
                    event_id=None,
                )

        return session

    def handle_buyer_move(self, session_id: str, move: BuyerMove) -> SessionResponse:
        """Process a buyer proposal or acceptance through the FSM, Prompt Router, and LLM."""
        # 1. Load session and evaluate lazy expiry
        session = self.get_session(session_id)
        fsm = NegotiationFSM(session)

        # 2. Check terminal states
        if session.status in ("AGREED", "REJECTED", "EXPIRED"):
            raise InvalidStateTransitionError(
                f"Session {session_id} is in terminal state '{session.status}'. No further proposals allowed.",
                current_state=session.status,
                attempted_event="handle_buyer_move",
            )

        # 3. Load SKU and Pricing Policy
        sku = self.repo.get_catalog_sku_by_code(session.sku_id)
        if not sku:
            raise ValueError(f"SKU {session.sku_id} not found.")

        policy = self.repo.get_pricing_policy_by_sku_id(sku["id"])
        if not policy:
            raise ValueError(f"Pricing policy for SKU {session.sku_id} not found.")

        max_rounds = policy.get("max_rounds", 5)
        floor_price = policy.get("floor_price", 0.0)
        cost_price = policy.get("cost_price", 0.0)
        min_margin_pct = policy.get("min_margin_pct", 0.0)
        margin_floor = max(cost_price * (1.0 + min_margin_pct / 100.0), floor_price)

        # 4. Load offer history
        events = self.repo.get_offer_events(session_id)

        # Extract last seller counter-offer price and check if resumed from merchant counter
        last_seller_price = sku.get("base_price", policy.get("list_price", 500.0))
        is_merchant_resumed = False
        merchant_counter_price: Optional[float] = None
        merchant_notes: Optional[str] = None

        if events:
            last_ev = events[-1]
            if str(last_ev.get("sender")).upper() == "MERCHANT":
                is_merchant_resumed = True
                merchant_counter_price = float(last_ev.get("proposed_price", last_seller_price))
                merchant_notes = last_ev.get("public_justification")

        for ev in reversed(events):
            if str(ev.get("sender")).upper() in ("SELLER_AI", "SELLER_GUARDRAIL", "MERCHANT"):
                last_seller_price = float(ev.get("proposed_price", last_seller_price))
                break

        # Pre-check for acceptance move state validity and re-validate against fresh state
        if move.accept_last_offer:
            if session.status not in ("IN_PROGRESS", "FINAL_OFFER"):
                raise InvalidStateTransitionError(
                    f"Cannot accept offer from state '{session.status}'.",
                    current_state=session.status,
                    attempted_event="buyer_accepts",
                )
            # Re-validate acceptance price and stock immediately
            accepted_price = move.offered_price if move.offered_price is not None else last_seller_price
            self._revalidate_acceptance(
                sku_id=session.sku_id,
                quantity=move.quantity,
                agreed_price=accepted_price,
            )

        # 5. Pre-call round increment (guarantees budget consumption before LLM call)
        prior_state = session.status
        expected_round = session.current_round + 1
        session.current_round += 1
        assert session.current_round == expected_round, (
            f"Round mismatch: DB returned {session.current_round}, expected {expected_round}"
        )

        # Advance state to IN_PROGRESS if INITIATED
        if session.status == "INITIATED":
            fsm.start_negotiation()

        self.repo.update_session(session)

        # 6. Record buyer offer event
        buyer_event_id = None
        if move.offered_price is not None:
            buyer_event = OfferEventRecord(
                session_id=session.id,
                round_number=session.current_round,
                sender="BUYER",
                quantity=move.quantity,
                proposed_price=move.offered_price,
                guardrail_clamped_price=move.offered_price,
                public_justification=move.buyer_message,
            )
            self.repo.record_offer_event(buyer_event)
            events.append(buyer_event.model_dump())
            buyer_event_id = buyer_event.id

        # 7. Select prompt template and build prompts
        template_name = pick_prompt_template(
            current_round=session.current_round,
            max_rounds=max_rounds,
            accept_last_offer=move.accept_last_offer,
            is_merchant_resumed=is_merchant_resumed,
        )

        sys_prompt = build_system_prompt(sku, policy)
        user_prompt = build_user_prompt(
            template_name=template_name,
            buyer_id=session.buyer_id,
            quantity=move.quantity,
            offered_price=move.offered_price or last_seller_price,
            buyer_message=move.buyer_message,
            catalog_sku=sku,
            pricing_policy=policy,
            current_round=session.current_round,
            max_rounds=max_rounds,
            offer_history=events,
            last_seller_price=last_seller_price,
            merchant_counter_price=merchant_counter_price,
            merchant_notes=merchant_notes,
        )

        # 8. Call LLM for NegotiationDecision
        try:
            raw_decision = self.llm_client.get_seller_response(sys_prompt, user_prompt)
        except Exception as exc:
            # Round was intentionally consumed before call; raise descriptive error
            raise RuntimeError(
                f"Round {session.current_round} was consumed but seller agent encountered an error: {exc}"
            ) from exc

        # 9. Apply post-LLM guardrail clamp and logical conflict resolution
        decision = apply_post_llm_guardrails(raw_decision, floor_price, margin_floor)

        # 10. Record seller response offer event
        seller_event = OfferEventRecord(
            session_id=session.id,
            round_number=session.current_round,
            sender="SELLER_GUARDRAIL",
            quantity=move.quantity,
            proposed_price=decision.counter_price,
            guardrail_clamped_price=decision.counter_price,
            rule_reason=decision.internal_reasoning,
            public_justification=decision.justification,
        )
        self.repo.record_offer_event(seller_event)

        # 11. State transitions based on decision and round limit
        payment_res = None
        status_msg = ""

        if decision.should_accept:
            # Re-validate against fresh stock and policy
            self._revalidate_acceptance(
                sku_id=session.sku_id,
                quantity=move.quantity,
                agreed_price=decision.counter_price,
            )

            # Transition to AGREED
            if session.status == "FINAL_OFFER":
                fsm.accept_final_offer()
            else:
                fsm.buyer_accepts()

            session.final_agreed_price = decision.counter_price
            
            # Fire Payment Link creation side-effect
            payment_res = self.payment_service.create_payment_link(
                session_id=session.id,
                sku_code=sku.get("sku_code", sku["id"]),
                quantity=move.quantity,
                unit_price=decision.counter_price,
                buyer_id=session.buyer_id,
            )
            self.repo.record_razorpay_order(
                session_id=session.id,
                razorpay_order_id=payment_res.razorpay_order_id,
                payment_link_id=payment_res.razorpay_payment_link_id,
                short_url=payment_res.payment_link_url,
                amount=payment_res.amount,
            )
            status_msg = f"Deal agreed at ₹{decision.counter_price:.2f}/unit. Payment link created."

        elif decision.needs_approval:
            # Transition to PENDING_APPROVAL with 30-minute expiry window (Decision 3)
            fsm.guardrail_escalates()
            session.pending_approval_price = decision.counter_price
            session.expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
            self.repo.record_merchant_approval(
                session_id=session.id,
                requested_price=decision.counter_price,
                status="PENDING",
                notes=decision.internal_reasoning,
            )
            status_msg = f"Proposed price of ₹{decision.counter_price:.2f} requires merchant escalation. Merchant has 30 minutes to respond."

        elif session.current_round >= max_rounds:
            # Transition to FINAL_OFFER take-it-or-leave-it
            fsm.reach_round_limit()
            session.final_offer_price = decision.counter_price
            session.expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
            status_msg = f"Round limit reached ({max_rounds}/{max_rounds}). Best and final offer expires in 15 minutes."

        else:
            # Stays IN_PROGRESS
            fsm.counter_offer()
            status_msg = f"Counter-offer proposed. {max_rounds - session.current_round} rounds remaining."

        # 12. Persist session updates and append audit log
        self.repo.update_session(session)
        self._append_audit(
            session_id=session.id,
            event_type="ROUND_EVALUATED",
            from_state=prior_state,
            to_state=session.status,
            actor="seller_ai",
            details={
                "round": session.current_round,
                "proposed_price": decision.counter_price,
                "should_accept": decision.should_accept,
                "needs_approval": decision.needs_approval,
                "justification": decision.justification,
            },
            event_id=seller_event.id,
        )

        return SessionResponse(
            session_id=session.id,
            sku_code=sku.get("sku_code", sku["id"]),
            status=session.status,
            current_round=session.current_round,
            max_rounds=max_rounds,
            seller_proposed_price=decision.counter_price,
            quantity=move.quantity,
            draft_justification=decision.justification,
            final_offer_price=session.final_offer_price,
            final_agreed_price=session.final_agreed_price,
            pending_approval_price=session.pending_approval_price,
            expires_at=session.expires_at,
            payment_link_url=payment_res.payment_link_url if payment_res else None,
            razorpay_order_id=payment_res.razorpay_order_id if payment_res else None,
            status_message=status_msg,
        )

    def handle_merchant_decision(
        self,
        session_id: str,
        decision: MerchantDecisionRequest,
    ) -> SessionResponse:
        """Process merchant response for deals flagged PENDING_APPROVAL."""
        session = self.get_session(session_id)
        if session.status != "PENDING_APPROVAL":
            raise InvalidStateTransitionError(
                f"Session {session_id} is in status '{session.status}', not PENDING_APPROVAL.",
                current_state=session.status,
                attempted_event="handle_merchant_decision",
            )

        fsm = NegotiationFSM(session)
        sku = self.repo.get_catalog_sku_by_code(session.sku_id)
        prior_state = session.status
        payment_res = None
        event_id = None

        if decision.decision.lower() == "approve":
            agreed_p = session.pending_approval_price or 0.0
            self._revalidate_acceptance(
                sku_id=session.sku_id,
                quantity=session.quantity,
                agreed_price=agreed_p,
            )
            fsm.merchant_approves()
            session.final_agreed_price = agreed_p
            self.repo.update_merchant_approval(session_id, status="APPROVED", notes=decision.merchant_notes)
            
            # Fire Payment Link creation
            payment_res = self.payment_service.create_payment_link(
                session_id=session.id,
                sku_code=sku.get("sku_code", sku["id"]),
                quantity=session.quantity,
                unit_price=agreed_p,
                buyer_id=session.buyer_id,
            )
            self.repo.record_razorpay_order(
                session_id=session.id,
                razorpay_order_id=payment_res.razorpay_order_id,
                payment_link_id=payment_res.razorpay_payment_link_id,
                short_url=payment_res.payment_link_url,
                amount=payment_res.amount,
            )
            status_msg = f"Merchant approved deal at ₹{agreed_p:.2f}. Payment link created."

        elif decision.decision.lower() == "reject":
            fsm.merchant_declines()
            self.repo.update_merchant_approval(session_id, status="REJECTED", notes=decision.merchant_notes)
            status_msg = "Merchant declined the proposed discount."

        elif decision.decision.lower() == "counter":
            if decision.counter_price is None:
                raise ValueError("Counter price must be provided when decision is 'counter'.")
            fsm.merchant_counters()
            self.repo.update_merchant_approval(session_id, status="COUNTERED", notes=f"Countered with ₹{decision.counter_price:.2f}: {decision.merchant_notes or ''}")
            
            # Record merchant counter offer event
            counter_event = OfferEventRecord(
                session_id=session.id,
                round_number=session.current_round,
                sender="MERCHANT",
                quantity=session.quantity,
                proposed_price=decision.counter_price,
                guardrail_clamped_price=decision.counter_price,
                public_justification=decision.merchant_notes or "Merchant counter-offer.",
            )
            self.repo.record_offer_event(counter_event)
            event_id = counter_event.id
            status_msg = f"Merchant proposed adjusted counter-price ₹{decision.counter_price:.2f}."

        else:
            raise ValueError(f"Invalid merchant decision '{decision.decision}'. Must be 'approve', 'reject', or 'counter'.")

        self.repo.update_session(session)
        self._append_audit(
            session_id=session.id,
            event_type="MERCHANT_DECISION",
            from_state=prior_state,
            to_state=session.status,
            actor="merchant",
            details={
                "decision": decision.decision,
                "notes": decision.merchant_notes,
                "counter_price": decision.counter_price,
            },
            event_id=event_id,
        )

        return SessionResponse(
            session_id=session.id,
            sku_code=sku.get("sku_code", sku["id"]),
            status=session.status,
            current_round=session.current_round,
            max_rounds=5,
            final_agreed_price=session.final_agreed_price,
            payment_link_url=payment_res.payment_link_url if payment_res else None,
            razorpay_order_id=payment_res.razorpay_order_id if payment_res else None,
            status_message=status_msg,
        )

    def accept_offer(self, session_id: str, buyer_id: str) -> SessionResponse:
        """Buyer accepts active offer during NEGOTIATING or FINAL_OFFER."""
        session = self.get_session(session_id)
        if session.status not in ("IN_PROGRESS", "FINAL_OFFER"):
            raise InvalidStateTransitionError(
                f"Session is in state '{session.status}', cannot accept offer.",
                current_state=session.status,
                attempted_event="accept_offer",
            )

        events = self.repo.get_offer_events(session_id)
        sku = self.repo.get_catalog_sku_by_code(session.sku_id)

        # Get latest seller proposed price
        latest_price = sku.get("base_price", 500.0)
        for ev in reversed(events):
            if str(ev.get("sender")).upper() in ("SELLER_AI", "SELLER_GUARDRAIL", "MERCHANT"):
                latest_price = float(ev.get("proposed_price", latest_price))
                break

        move = BuyerMove(quantity=session.quantity, offered_price=latest_price, accept_last_offer=True)
        return self.handle_buyer_move(session_id, move)

    def decline_offer(self, session_id: str, buyer_id: str) -> SessionResponse:
        """Buyer declines offer and terminates negotiation."""
        session = self.get_session(session_id)
        fsm = NegotiationFSM(session)
        prior_state = session.status

        if session.status == "FINAL_OFFER":
            fsm.decline_final_offer()
        elif session.status == "IN_PROGRESS":
            fsm.buyer_walks()
        else:
            raise InvalidStateTransitionError(
                f"Session is in state '{session.status}', cannot decline.",
                current_state=session.status,
                attempted_event="decline_offer",
            )

        self.repo.update_session(session)
        self._append_audit(
            session_id=session.id,
            event_type="BUYER_DECLINED",
            from_state=prior_state,
            to_state=session.status,
            actor="buyer",
            details={"buyer_id": buyer_id},
            event_id=None,
        )

        sku = self.repo.get_catalog_sku_by_code(session.sku_id)
        return SessionResponse(
            session_id=session.id,
            sku_code=sku.get("sku_code", sku["id"]),
            status=session.status,
            current_round=session.current_round,
            max_rounds=5,
            status_message="Negotiation ended. Buyer declined offer.",
        )
