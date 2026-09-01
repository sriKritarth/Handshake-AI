"""Finite State Machine (FSM) definition using python-statemachine."""
from __future__ import annotations

from typing import Any
from statemachine import StateMachine, State
from statemachine.exceptions import TransitionNotAllowed


class InvalidStateTransitionError(Exception):
    """Raised when an illegal state machine transition is attempted."""

    def __init__(self, message: str, current_state: str, attempted_event: str) -> None:
        super().__init__(message)
        self.current_state = current_state
        self.attempted_event = attempted_event


class NegotiationStateMachine(StateMachine):
    """Declarative Finite State Machine for B2B Wholesale Negotiation Sessions."""

    # 1. States Definition
    INITIATED = State(initial=True, value="INITIATED")
    IN_PROGRESS = State(value="IN_PROGRESS")
    PENDING_APPROVAL = State(value="PENDING_APPROVAL")
    FINAL_OFFER = State(value="FINAL_OFFER")
    AGREED = State(final=True, value="AGREED")
    REJECTED = State(final=True, value="REJECTED")
    EXPIRED = State(final=True, value="EXPIRED")

    # 2. Transitions
    start_negotiation = INITIATED.to(IN_PROGRESS)
    counter_offer = IN_PROGRESS.to(IN_PROGRESS)
    guardrail_escalates = IN_PROGRESS.to(PENDING_APPROVAL)
    reach_round_limit = IN_PROGRESS.to(FINAL_OFFER)
    buyer_accepts = IN_PROGRESS.to(AGREED)
    buyer_walks = IN_PROGRESS.to(REJECTED)

    merchant_approves = PENDING_APPROVAL.to(AGREED)
    merchant_declines = PENDING_APPROVAL.to(REJECTED)
    merchant_counters = PENDING_APPROVAL.to(IN_PROGRESS)

    accept_final_offer = FINAL_OFFER.to(AGREED)
    decline_final_offer = FINAL_OFFER.to(REJECTED)
    lazy_expire = FINAL_OFFER.to(EXPIRED)


class NegotiationFSM:
    """Wrapper around NegotiationStateMachine providing exception mapping and model binding."""

    def __init__(self, model: Any) -> None:
        self.model = model
        # Bind the state machine to the model's 'status' field
        self._machine = NegotiationStateMachine(model=model, state_field="status")

    @property
    def current_state(self) -> str:
        return str(self.model.status)

    def _trigger(self, event_name: str, *args: Any, **kwargs: Any) -> Any:
        try:
            event_method = getattr(self._machine, event_name)
            return event_method(*args, **kwargs)
        except TransitionNotAllowed as exc:
            raise InvalidStateTransitionError(
                f"Cannot execute event '{event_name}' on session in state '{self.current_state}'.",
                current_state=self.current_state,
                attempted_event=event_name,
            ) from exc

    def start_negotiation(self) -> None:
        self._trigger("start_negotiation")

    def counter_offer(self) -> None:
        self._trigger("counter_offer")

    def guardrail_escalates(self) -> None:
        self._trigger("guardrail_escalates")

    def reach_round_limit(self) -> None:
        self._trigger("reach_round_limit")

    def buyer_accepts(self) -> None:
        self._trigger("buyer_accepts")

    def buyer_walks(self) -> None:
        self._trigger("buyer_walks")

    def merchant_approves(self) -> None:
        self._trigger("merchant_approves")

    def merchant_declines(self) -> None:
        self._trigger("merchant_declines")

    def merchant_counters(self) -> None:
        self._trigger("merchant_counters")

    def accept_final_offer(self) -> None:
        self._trigger("accept_final_offer")

    def decline_final_offer(self) -> None:
        self._trigger("decline_final_offer")

    def lazy_expire(self) -> None:
        self._trigger("lazy_expire")
