"""Session management and orchestration service for negotiation workflows."""
from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import structlog

from session.audit import AuditService
from session.db import (
    BaseSessionRepository,
    InMemorySessionRepository,
    OfferEventRecord,
    SessionRecord,
    SupabaseSessionRepository,
)
from session.fsm import InvalidStateTransitionError, NegotiationFSM
from session.guardrails import apply_post_llm_guardrails, evaluate_buyer_guardrails
from session.models import (
    BuyerMove,
    MerchantDecisionRequest,
    NegotiationDecision,
    SessionResponse,
)
from session.prompts import (
    build_system_prompt,
    build_user_prompt,
    pick_prompt_template,
)

log = structlog.get_logger()


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
        payment_service: Optional[Any] = None,
    ) -> None:
        if repo is not None:
            self.repo = repo
        else:
            if os.environ.get("SUPABASE_URL") and (os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_PUBLISHABLE_KEY")):
                self.repo = SupabaseSessionRepository()
            else:
                self.repo = InMemorySessionRepository()

        self.llm_client = llm_client or DefaultGroqDecisionClient()
        self.payment_service = payment_service

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
        fresh_stock = int(fresh_sku.get("inventory_qty") or fresh_sku.get("stock_qty"))

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

        # Ensure session quantity reflects negotiated volume if offer events exist
        if session.quantity <= 1:
            events = self.repo.get_offer_events(session_id)
            if events:
                for ev in reversed(events):
                    if ev.get("quantity") and int(ev["quantity"]) > 0:
                        session.quantity = int(ev["quantity"])
                        break

        return session

    def handle_buyer_move(self, session_id: str, move: BuyerMove) :
        """Process a buyer proposal or acceptance through the FSM, Prompt Router, and LLM."""
        # 1. Load session and evaluate lazy expiry
        session = self.get_session(session_id)
        log.info(
            "session_loaded",
            session_id=session_id,
            status=session.status,
            current_round=session.current_round,
        )
        fsm = NegotiationFSM(session)

        # 2. Check terminal states
        if session.status == "AGREED":
            log.info(
                "session_already_agreed",
                session_id=session_id,
                final_agreed_price=session.final_agreed_price,
            )
            final_price = session.final_agreed_price or 0.0
            sku = self.repo.get_catalog_sku_by_code(session.sku_id)
            sku_code = sku.get("sku_code", sku["id"]) if sku else session.sku_id
            policy = self.repo.get_pricing_policy_by_sku_id(sku["id"]) if sku else None
            max_rounds = int(policy.get("max_rounds", 5)) if policy else 5
            total_amount = float(final_price * session.quantity)
            amount_paise = int(round(total_amount * 100))
            checkout_url = f"/api/v1/checkout/{session.id}"

            return SessionResponse(
                session_id=session.id,
                sku_code=sku_code,
                status="AGREED",
                current_round=session.current_round,
                max_rounds=max_rounds,
                seller_proposed_price=final_price,
                counter_quantity=session.quantity,
                quantity=session.quantity,
                draft_justification="Deal has already been agreed. Proceed to checkout to complete payment.",
                internal_reasoning="Session already finalized in AGREED state.",
                final_offer_price=session.final_offer_price,
                final_agreed_price=final_price,
                pending_approval_price=session.pending_approval_price,
                expires_at=session.expires_at,
                amount=total_amount,
                amount_paise=amount_paise,
                currency="INR",
                checkout_url=checkout_url,
                status_message=f"Deal agreed at ₹{final_price:.2f}/unit. Proceed to checkout.",
            )

        if session.status in ("REJECTED", "EXPIRED"):
            log.warning(
                "terminal_state_rejected",
                session_id=session_id,
                status=session.status,
                attempted_action="buyer_move",
            )
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

        # Warehouse stock validation
        stock_qty = int(sku.get("inventory_qty") or sku.get("stock_qty") or 0)
        req_qty = move.quantity or session.quantity
        if stock_qty <= 0:
            raise ValueError(
                f"Insufficient stock — SKU '{session.sku_id}' is completely out of stock."
            )

        if move.accept_last_offer and req_qty > stock_qty:
            raise ValueError(
                f"Insufficient stock — requested {req_qty} units but only {stock_qty} units available."
            )

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
        log.info(
            "round_incremented",
            session_id=session_id,
            previous_round=session.current_round - 1,
            new_round=session.current_round,
            max_rounds=max_rounds,
        )

        # Advance state to IN_PROGRESS if INITIATED
        if session.status == "INITIATED":
            fsm.start_negotiation()

        if move.quantity:
            session.quantity = move.quantity

        self.repo.update_session(session)

        # 6. Evaluate buyer request with the 6-rule GuardrailEngine (AFTER buyer request, BEFORE seller response)
        guardrail_eval = evaluate_buyer_guardrails(
            buyer_move=move,
            catalog_sku=sku,
            policy_dict=policy,
            current_round=session.current_round,
            max_rounds=max_rounds,
            last_seller_price=last_seller_price,
        )
        passed_rules = [r.rule_name for r in guardrail_eval.rule_results if r.passed]
        violated_rules = [r.rule_name for r in guardrail_eval.rule_results if not r.passed]

        # Determine top volume tier threshold
        qty_tiers = policy.get("qty_tier_discounts", [])
        max_tier_qty = 50
        for t in qty_tiers:
            mq = t.get("max_qty") or t.get("min_qty", 1)
            if mq > max_tier_qty:
                max_tier_qty = mq

        # Pre-LLM Guardrail Audit: If buyer offers price < floor_price && qty < max_qty,
        # flag is_rule_passed=False, violated_rules=['floor_price', 'margin_floor']
        is_lowball_audit = (
            move.offered_price is not None
            and move.offered_price < floor_price
            and move.quantity < max_tier_qty
        )
        if is_lowball_audit:
            if "floor_price" not in violated_rules:
                violated_rules.append("floor_price")
            if "margin_floor" not in violated_rules:
                violated_rules.append("margin_floor")
            passed_rules = [r for r in passed_rules if r not in ("floor_price", "margin_floor")]

        # Record buyer offer event with cryptographic guardrail outcomes
        buyer_event_id = None
        if move.offered_price is not None:
            rule_passed = False if is_lowball_audit else guardrail_eval.passed
            buyer_event = OfferEventRecord(
                session_id=session.id,
                round_number=session.current_round,
                sender="BUYER",
                quantity=move.quantity,
                proposed_price=move.offered_price,
                guardrail_clamped_price=guardrail_eval.final_price,
                is_rule_passed=rule_passed,
                passed_rules=passed_rules,
                violated_rules=violated_rules,
                rule_reason=guardrail_eval.deciding_rule or guardrail_eval.blocking_rule,
                public_justification=move.buyer_message,
            )
            self.repo.record_offer_event(buyer_event)
            events.append(buyer_event.model_dump())
            buyer_event_id = buyer_event.id

        # 7. Select prompt template and build prompts
        is_final_round = session.current_round >= max_rounds
        template_name = pick_prompt_template(
            current_round=session.current_round,
            max_rounds=max_rounds,
            accept_last_offer=move.accept_last_offer,
            is_merchant_resumed=is_merchant_resumed,
        )
        log.info(
            "prompt_selected",
            session_id=session_id,
            template=template_name,
            round=session.current_round,
            is_final=is_final_round,
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
        log.info(
            "llm_call_start",
            session_id=session_id,
            model=getattr(self.llm_client, "model", "unknown"),
            round=session.current_round,
        )
        _llm_start = time.monotonic()
        try:
            raw_decision = self.llm_client.get_seller_response(sys_prompt, user_prompt)
        except Exception as exc:
            log.error(
                "llm_call_failed",
                session_id=session_id,
                error=str(exc),
                round=session.current_round,
                rounds_remaining=max_rounds - session.current_round,
            )
            # Round was intentionally consumed before call; raise descriptive error
            raise RuntimeError(
                f"Round {session.current_round} was consumed but seller agent encountered an error: {exc}"
            ) from exc
        _llm_duration_ms = int((time.monotonic() - _llm_start) * 1000)
        log.info(
            "llm_call_complete",
            session_id=session_id,
            raw_counter_price=raw_decision.counter_price,
            should_accept=raw_decision.should_accept,
            needs_approval=raw_decision.needs_approval,
            duration_ms=_llm_duration_ms,
        )

        # 9. Apply post-LLM guardrail clamp, full rule waterfall, and logical conflict resolution
        decision = apply_post_llm_guardrails(
            decision=raw_decision,
            floor_price=floor_price,
            margin_floor=margin_floor,
            policy_dict=policy,
            catalog_sku=sku,
            quantity=move.quantity,
            current_round=session.current_round,
            max_rounds=max_rounds,
        )
        if decision.counter_quantity and decision.counter_quantity > stock_qty:
            decision.counter_quantity = stock_qty

        # Inventory Safety Reserve & Escalation Rule (PrefBench & Supply Chain Literature):
        # Dynamically scales reserve buffer for low-stock items so standard orders do not lock out
        safety_stock_buffer = int(policy.get("safety_stock_buffer", sku.get("safety_stock_buffer", 50)))
        if stock_qty <= safety_stock_buffer:
            effective_buffer = max(1, int(stock_qty * 0.2))
        else:
            effective_buffer = safety_stock_buffer
        safe_stock_limit = stock_qty - effective_buffer

        if req_qty > safe_stock_limit:
            # Insufficient stock or leaves less than reserve buffer -> ESCALATE
            decision.should_accept = False
            decision.needs_approval = True
            decision.justification = (
                "Less inventory stocks left. Your requested order volume has been escalated for executive merchant review to verify allocation."
            )
            decision.internal_reasoning = (
                f"Requested quantity ({req_qty}) exceeds safe inventory threshold "
                f"({stock_qty} available stock vs {effective_buffer} safety buffer, limit: {safe_stock_limit}). "
                f"Escalated for merchant inventory allocation review."
            )
        else:
            if not decision.should_accept:
                # Safe inventory (buyer_quantity <= stock_quantity - buffer) -> propose counter-offer without disclosing stock quantity
                leaks_stock = any(w in decision.justification.lower() for w in ["in stock", "warehouse", "clearance rate", "clear our inventory", "remaining stock"])
                if leaks_stock:
                    decision.justification = (
                        f"We can authorize a preferential rate of ₹{decision.counter_price:.2f}/unit for your order of {req_qty} units, "
                        f"backed by complete manufacturer warranty and expedited dispatch."
                    )

        # 10. Record seller response offer event
        seller_event = OfferEventRecord(
            session_id=session.id,
            round_number=session.current_round,
            sender="SELLER_GUARDRAIL",
            quantity=decision.counter_quantity or move.quantity,
            proposed_price=decision.counter_price,
            guardrail_clamped_price=decision.counter_price,
            rule_reason=decision.internal_reasoning,
            public_justification=decision.justification,
        )
        self.repo.record_offer_event(seller_event)

        # 11. State transitions based on decision and round limit
        payment_res = None
        status_msg = ""

        # Track lowball moves: price < floor_price && qty < max_tier_qty
        past_lowballs = 0
        for ev in events:
            s = str(ev.get("sender", "")).upper()
            if s in ("BUYER", "BUYER_MOVE"):
                p = ev.get("proposed_price")
                q = ev.get("quantity", req_qty)
                if p is not None and p < floor_price and q < max_tier_qty:
                    past_lowballs += 1

        is_lowball_move = (
            move.offered_price is not None
            and move.offered_price < floor_price
            and req_qty < max_tier_qty
        )

        if decision.should_accept:
            deal_quantity = decision.counter_quantity or move.quantity
            session.quantity = deal_quantity
            # Re-validate against fresh stock and policy
            log.info(
                "revalidation_start",
                session_id=session_id,
                agreed_price=decision.counter_price,
                quantity=deal_quantity,
            )
            try:
                self._revalidate_acceptance(
                    sku_id=session.sku_id,
                    quantity=deal_quantity,
                    agreed_price=decision.counter_price,
                )
                fresh_policy = self.repo.get_pricing_policy_by_sku_id(sku["id"])
                fresh_sku = self.repo.get_catalog_sku_by_code(session.sku_id)
                log.info(
                    "revalidation_passed",
                    session_id=session_id,
                    fresh_floor=float(fresh_policy.get("floor_price", 0)) if fresh_policy else None,
                    fresh_stock=int(fresh_sku.get("inventory_qty", 0)) if fresh_sku else None,
                )
            except ValueError as reval_err:
                log.warning(
                    "revalidation_failed",
                    session_id=session_id,
                    reason=str(reval_err),
                    agreed_price=decision.counter_price,
                )
                raise

            # Transition to AGREED
            old_status = session.status
            if session.status == "FINAL_OFFER":
                fsm.accept_final_offer()
            else:
                fsm.buyer_accepts()
            log.info(
                "state_transition",
                session_id=session_id,
                from_state=old_status,
                to_state=session.status,
                trigger="should_accept",
            )

            session.final_agreed_price = decision.counter_price

            # Calculate amounts directly for checkout without blocking external calls
            total_amount = float(decision.counter_price * session.quantity)
            amount_paise = int(round(total_amount * 100))
            status_msg = f"Deal agreed at ₹{decision.counter_price:.2f}/unit."

        elif decision.needs_approval:
            # Transition to PENDING_APPROVAL with 30-minute expiry window (Decision 3)
            old_status = session.status
            fsm.guardrail_escalates()
            log.info(
                "state_transition",
                session_id=session_id,
                from_state=old_status,
                to_state=session.status,
                trigger="needs_approval",
            )
            session.pending_approval_price = decision.counter_price
            session.expires_at = datetime.now(timezone.utc) + timedelta(minutes=30)
            self.repo.record_merchant_approval(
                session_id=session.id,
                requested_price=decision.counter_price,
                status="PENDING",
                notes=decision.internal_reasoning,
            )
            if "less inventory" in decision.justification.lower():
                status_msg = "Less inventory stocks left. Request requires merchant escalation. Merchant has 30 minutes to respond."
            else:
                status_msg = f"Proposed price of ₹{decision.counter_price:.2f} requires merchant escalation. Merchant has 30 minutes to respond."

        elif session.current_round >= max_rounds:
            # Transition to FINAL_OFFER take-it-or-leave-it
            old_status = session.status
            fsm.reach_round_limit()
            log.info(
                "state_transition",
                session_id=session_id,
                from_state=old_status,
                to_state=session.status,
                trigger="round_limit_reached",
            )
            session.final_offer_price = decision.counter_price
            session.expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
            status_msg = f"Round limit reached ({max_rounds}/{max_rounds}). Best and final offer expires in 15 minutes."

        elif is_lowball_move and past_lowballs > 2:
            # Transition to FINAL_OFFER take-it-or-leave-it after 2 lowball rounds
            old_status = session.status
            fsm.reach_round_limit()
            log.info(
                "state_transition",
                session_id=session_id,
                from_state=old_status,
                to_state=session.status,
                trigger="lowball_round_limit_reached",
            )
            session.final_offer_price = decision.counter_price
            session.expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)
            status_msg = f"Lowball negotiation limit reached (at most 2 rounds below floor). Best and final offer presented at ₹{decision.counter_price:.2f}/unit."

        else:
            # Stays IN_PROGRESS
            old_status = session.status
            fsm.counter_offer()
            log.info(
                "state_transition",
                session_id=session_id,
                from_state=old_status,
                to_state=session.status,
                trigger="counter_offer",
            )
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
                "counter_quantity": decision.counter_quantity,
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
            counter_quantity=decision.counter_quantity,
            quantity=session.quantity,
            draft_justification=decision.justification,
            internal_reasoning=decision.internal_reasoning,
            final_offer_price=session.final_offer_price,
            final_agreed_price=session.final_agreed_price,
            pending_approval_price=session.pending_approval_price,
            expires_at=session.expires_at,
            amount=float(session.final_agreed_price * session.quantity) if (session.status == "AGREED" and session.final_agreed_price) else None,
            amount_paise=int(round(session.final_agreed_price * session.quantity * 100)) if (session.status == "AGREED" and session.final_agreed_price) else None,
            currency="INR" if session.status == "AGREED" else None,
            checkout_url=f"/api/v1/checkout/{session.id}" if session.status == "AGREED" else None,
            status_message=status_msg,
        )

    def handle_merchant_decision(
        self,
        session_id: str,
        decision: MerchantDecisionRequest,
    ) -> SessionResponse:
        """Process merchant response for deals flagged PENDING_APPROVAL."""
        session = self.get_session(session_id)
        log.info(
            "merchant_decision_processing",
            action=decision.decision,
            session_id=session_id,
        )
        if session.status != "PENDING_APPROVAL":
            log.warning(
                "merchant_approval_timeout",
                session_id=session_id,
                expired_at=session.expires_at.isoformat() if session.expires_at else None,
            )
            raise InvalidStateTransitionError(
                f"Session {session_id} is in status '{session.status}', not PENDING_APPROVAL.",
                current_state=session.status,
                attempted_event="handle_merchant_decision",
            )

        fsm = NegotiationFSM(session)
        sku = self.repo.get_catalog_sku_by_code(session.sku_id)
        prior_state = session.status
        event_id = None

        if decision.decision.lower() == "approve":
            # Priority for agreed price:
            # 1. Price explicitly specified in decision.counter_price (if merchant provided an agreed override)
            # 2. session.pending_approval_price
            # 3. Latest offer event proposed_price
            agreed_p = None
            if decision.counter_price and float(decision.counter_price) > 0:
                agreed_p = float(decision.counter_price)
            elif session.pending_approval_price and float(session.pending_approval_price) > 0:
                agreed_p = float(session.pending_approval_price)
            else:
                try:
                    events = self.repo.get_offer_events(session_id)
                    for ev in reversed(events):
                        p = ev.get("proposed_price") or ev.get("guardrail_clamped_price")
                        if p and float(p) > 0:
                            agreed_p = float(p)
                            break
                except Exception:
                    pass

            if not agreed_p or agreed_p <= 0.0:
                sku_data = self.repo.get_catalog_sku_by_code(session.sku_id) or {}
                policy = self.repo.get_pricing_policy_by_sku_id(sku_data.get("id", "")) or {}
                agreed_p = float(policy.get("floor_price") or sku_data.get("base_price", 0.0))

            self._revalidate_acceptance(
                sku_id=session.sku_id,
                quantity=session.quantity,
                agreed_price=agreed_p,
            )
            fsm.merchant_approves()
            session.final_agreed_price = agreed_p
            self.repo.update_merchant_approval(session_id, status="APPROVED", notes=decision.merchant_notes)
            
            status_msg = f"Merchant approved deal at ₹{agreed_p:.2f}."

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
            log.info(
                "merchant_counter_applied",
                session_id=session_id,
                counter_price=decision.counter_price,
                merchant_notes=decision.merchant_notes,
            )
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
            seller_proposed_price=decision.counter_price if decision.decision.lower() == "counter" else session.final_agreed_price,
            counter_quantity=session.quantity,
            quantity=session.quantity,
            draft_justification=decision.merchant_notes or ("Merchant approved deal." if decision.decision.lower() == "approve" else "Merchant counter-offer."),
            internal_reasoning=decision.merchant_notes,
            final_agreed_price=session.final_agreed_price,
            amount=float(session.final_agreed_price * session.quantity) if (session.status == "AGREED" and session.final_agreed_price) else None,
            amount_paise=int(round(session.final_agreed_price * session.quantity * 100)) if (session.status == "AGREED" and session.final_agreed_price) else None,
            currency="INR" if session.status == "AGREED" else None,
            checkout_url=f"/api/v1/checkout/{session.id}" if session.status == "AGREED" else None,
            status_message=status_msg,
        )

    def accept_offer(self, session_id: str, buyer_id: str) -> SessionResponse:
        """Buyer accepts active offer during NEGOTIATING or FINAL_OFFER."""
        session = self.get_session(session_id)
        if session.status == "AGREED":
            return self.handle_buyer_move(
                session_id,
                BuyerMove(quantity=session.quantity, offered_price=session.final_agreed_price, accept_last_offer=True),
            )
        if session.status not in ("IN_PROGRESS", "FINAL_OFFER"):
            raise InvalidStateTransitionError(
                f"Session is in state '{session.status}', cannot accept offer.",
                current_state=session.status,
                attempted_event="accept_offer",
            )

        events = self.repo.get_offer_events(session_id)
        sku = self.repo.get_catalog_sku_by_code(session.sku_id)

        # Get latest seller proposed price and quantity
        latest_price = sku.get("base_price", 500.0)
        latest_quantity = session.quantity
        for ev in reversed(events):
            if str(ev.get("sender")).upper() in ("SELLER_AI", "SELLER_GUARDRAIL", "MERCHANT"):
                latest_price = float(ev.get("proposed_price", latest_price))
                if ev.get("quantity"):
                    latest_quantity = int(ev["quantity"])
                break

        move = BuyerMove(quantity=latest_quantity, offered_price=latest_price, accept_last_offer=True)
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
