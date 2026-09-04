"""
Agent-to-Agent Negotiation Demo — Full Endpoint Integration
============================================================
Buyer LLM (Groq/Instructor) <-> Seller LLM (FastAPI + Groq)

Endpoints exercised:
  GET  /health                             — startup server check
  POST /sessions                           — create session (admin key)
  GET  /sessions/{id}                      — poll session state (buyer key)
  POST /sessions/{id}/moves                — buyer offers (buyer key)
  POST /sessions/{id}/accept               — buyer accepts (buyer key)
  POST /sessions/{id}/decline              — buyer walks away (buyer key)
  POST /sessions/{id}/merchant-decision    — auto-merchant (merchant key, if AUTO_MERCHANT=true)
  GET  /sessions/{id}/audit                — full audit chain (admin key)
  GET  /sessions/{id}/replay               — chronological timeline (Phase 7)
  GET  /sessions/{id}/verify               — per-entry hash validation (Phase 7)

Usage:
    # 1. Start server:
    #    uvicorn backend.main:app --reload --port 8000
    #
    # 2. Seed keys (first time):
    #    python demo/seed_api_keys.py
    #
    # 3. Run:
    #    python demo/a2a_demo.py
    #
    # Env tunables (all optional):
    #    SKU_CODE, QUANTITY, BUYER_ID
    #    LIST_PRICE, TARGET_PRICE, WALK_AWAY_PRICE, OPENING_OFFER, MAX_ROUNDS
    #    AUTO_MERCHANT=true          — auto-approve pending deals (demo mode)
    #    AUTO_MERCHANT_ACTION=approve|reject|counter
    #    AUTO_MERCHANT_COUNTER=<price>
    #    POLL_INTERVAL_SEC=5         — seconds between merchant polls
    #    POLL_TIMEOUT_SEC=300        — give up after this many seconds
    #    MOVE_RETRY_ATTEMPTS=3       — retries on 429 rate-limit
    #    MOVE_RETRY_BACKOFF_SEC=6    — base sleep before each retry
"""
from __future__ import annotations

import os
import sys
import time

# ── UTF-8 on Windows consoles ─────────────────────────────────────────────
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# ── project root on path ──────────────────────────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(dotenv_path=".env", override=True)

import requests

# ─────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────

API_BASE      = os.getenv("API_BASE",   "http://localhost:8000/api/v1")
ADMIN_KEY     = os.getenv("ADMIN_KEY")
BUYER_KEY     = os.getenv("BUYER_KEY")
MERCHANT_KEY  = os.getenv("MERCHANT_KEY")      # optional — needed for auto-merchant mode

HDR_ADMIN    = {"X-API-Key": ADMIN_KEY,    "Content-Type": "application/json"}
HDR_BUYER    = {"X-API-Key": BUYER_KEY,    "Content-Type": "application/json"}
HDR_MERCHANT = {"X-API-Key": MERCHANT_KEY, "Content-Type": "application/json"} if MERCHANT_KEY else {}

SKU_CODE   = os.getenv("SKU_CODE",   "TSH-PREM-001")
QUANTITY   = int(os.getenv("QUANTITY", "50"))
BUYER_ID   = os.getenv("BUYER_ID",   "ai-buyer-agent-001")

BUYER_CONFIG = {
    "product_name":    os.getenv("PRODUCT_NAME", "Premium Heavyweight Cotton T-Shirt"),
    "sku_code":        SKU_CODE,
    "quantity":        QUANTITY,
    "list_price":      float(os.getenv("LIST_PRICE",      "1499")),
    "target_price":    float(os.getenv("TARGET_PRICE",    "1150")),
    "walk_away_price": float(os.getenv("WALK_AWAY_PRICE", "1350")),
    "opening_offer":   float(os.getenv("OPENING_OFFER",  "950")),
    "max_rounds":      int(os.getenv("MAX_ROUNDS",        "5")),
}

AUTO_MERCHANT         = os.getenv("AUTO_MERCHANT", "false").lower() == "true"
AUTO_MERCHANT_ACTION  = os.getenv("AUTO_MERCHANT_ACTION", "approve")   # approve|reject|counter
AUTO_MERCHANT_COUNTER = float(os.getenv("AUTO_MERCHANT_COUNTER", "0") or "0")
POLL_INTERVAL_SEC     = int(os.getenv("POLL_INTERVAL_SEC", "5"))
POLL_TIMEOUT_SEC      = int(os.getenv("POLL_TIMEOUT_SEC",  "300"))     # 5 minutes default

# Rate-limit retry settings for POST /sessions/{id}/moves (server allows 10/minute).
# On a 429 response the demo will sleep MOVE_RETRY_BACKOFF_SEC * attempt and try again.
MOVE_RETRY_ATTEMPTS   = int(os.getenv("MOVE_RETRY_ATTEMPTS",   "3"))
MOVE_RETRY_BACKOFF_SEC = int(os.getenv("MOVE_RETRY_BACKOFF_SEC", "6"))


# ─────────────────────────────────────────────────────────────────────────
# Print helpers
# ─────────────────────────────────────────────────────────────────────────

def _line(char: str = "-", width: int = 60) -> None:
    print(char * width)


def _ok(label: str, msg: str = "") -> None:
    print(f"  [OK]  {label}" + (f": {msg}" if msg else ""))


def _err(label: str, msg: str = "") -> None:
    print(f"  [ERR] {label}" + (f": {msg}" if msg else ""), file=sys.stderr)


# ─────────────────────────────────────────────────────────────────────────
# Step 0 — Health check
# ─────────────────────────────────────────────────────────────────────────

def health_check() -> None:
    """Verify the API server is reachable before starting."""
    resp = requests.get(f"{API_BASE}/health", timeout=5)
    resp.raise_for_status()
    data = resp.json()
    _ok("Server healthy", f"phase={data.get('phase')} engine={data.get('engine')}")


# ─────────────────────────────────────────────────────────────────────────
# Step 1 — Create session
# ─────────────────────────────────────────────────────────────────────────

def create_session() -> tuple[str, int]:
    """Create negotiation session. Returns (session_id, max_rounds)."""
    resp = requests.post(
        f"{API_BASE}/sessions",
        json={
            "buyer_id": BUYER_ID,
            "sku_code": SKU_CODE,
            "quantity": QUANTITY,
            "channel":  "CHAT",
        },
        headers=HDR_ADMIN,
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    sid = data["session_id"]
    # The API returns max_rounds only in domain SessionResponse, not the HTTP one.
    # Fall back to BUYER_CONFIG default if not present.
    max_rounds = data.get("max_rounds") or BUYER_CONFIG["max_rounds"]
    _ok("Session created", f"id={sid} status={data['status']}")
    return sid, max_rounds


# ─────────────────────────────────────────────────────────────────────────
# Step 2a — Poll session state (for PENDING_APPROVAL waiting)
# ─────────────────────────────────────────────────────────────────────────

def get_session(session_id: str) -> dict:
    resp = requests.get(
        f"{API_BASE}/sessions/{session_id}",
        headers=HDR_BUYER,
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


# ─────────────────────────────────────────────────────────────────────────
# Step 2b — Auto-merchant decision (demo mode only)
# ─────────────────────────────────────────────────────────────────────────

def auto_merchant_decide(session_id: str) -> dict:
    """Simulate merchant approving/rejecting/countering for demo testing."""
    if not MERCHANT_KEY:
        print("  [WARN] AUTO_MERCHANT=true but no MERCHANT_KEY in .env — skipping")
        return {}

    payload: dict = {"action": AUTO_MERCHANT_ACTION}
    if AUTO_MERCHANT_ACTION == "counter":
        payload["counter_price"] = AUTO_MERCHANT_COUNTER or BUYER_CONFIG["walk_away_price"]
        payload["merchant_notes"] = "Auto-demo counter from buyer agent script"
    else:
        payload["merchant_notes"] = f"Auto-demo {AUTO_MERCHANT_ACTION}"

    resp = requests.post(
        f"{API_BASE}/sessions/{session_id}/merchant-decision",
        json=payload,
        headers=HDR_MERCHANT,
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    _ok(f"Auto-merchant {AUTO_MERCHANT_ACTION}", f"status={data['status']}")
    return data


# ─────────────────────────────────────────────────────────────────────────
# Step 2c — Poll for merchant decision, with auto-approve in demo mode
# ─────────────────────────────────────────────────────────────────────────

def wait_for_merchant(session_id: str) -> dict:
    """
    Block until merchant resolves PENDING_APPROVAL.
    In AUTO_MERCHANT mode, trigger the decision immediately then return.
    Otherwise poll GET /sessions/{id} every POLL_INTERVAL_SEC seconds.

    Returns the resolved session dict (status will be AGREED/REJECTED/IN_PROGRESS).
    """
    if AUTO_MERCHANT:
        print(f"\n  [AUTO-MERCHANT] Triggering '{AUTO_MERCHANT_ACTION}' decision...")
        result = auto_merchant_decide(session_id)
        if result:
            return result
        # If auto-merchant failed, fall through to poll

    print(f"\n  [WAITING] Merchant reviewing deal. Polling every {POLL_INTERVAL_SEC}s "
          f"(timeout: {POLL_TIMEOUT_SEC}s)...")

    deadline = time.monotonic() + POLL_TIMEOUT_SEC
    dots = 0
    while time.monotonic() < deadline:
        time.sleep(POLL_INTERVAL_SEC)
        session = get_session(session_id)
        status = session["status"]
        dots += 1
        print(f"  ... [{dots * POLL_INTERVAL_SEC}s] status={status}", end="\r")
        if status != "PENDING_APPROVAL":
            print()  # newline after \r
            _ok(f"Merchant resolved", f"status={status}")
            return session

    print()
    print(f"  [TIMEOUT] Merchant did not respond within {POLL_TIMEOUT_SEC}s.")
    return get_session(session_id)


# ─────────────────────────────────────────────────────────────────────────
# Step 3 — Accept / Decline endpoints
# ─────────────────────────────────────────────────────────────────────────

def accept_offer(session_id: str) -> dict:
    resp = requests.post(
        f"{API_BASE}/sessions/{session_id}/accept",
        headers=HDR_BUYER,
        timeout=20,
    )
    resp.raise_for_status()
    return resp.json()


def decline_offer(session_id: str) -> dict:
    resp = requests.post(
        f"{API_BASE}/sessions/{session_id}/decline",
        headers=HDR_BUYER,
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


# ─────────────────────────────────────────────────────────────────────────
# Step 4 — Core negotiation loop
# ─────────────────────────────────────────────────────────────────────────

def run_negotiation(session_id: str, max_rounds: int) -> None:
    """Full LLM buyer vs seller negotiation loop using all relevant endpoints."""
    from demo.buyer_agent.agent import BuyerAgent

    # Align buyer config with server's max_rounds
    config = {
        **BUYER_CONFIG,
        "max_rounds": max_rounds,
        "max_budget": BUYER_CONFIG.get("max_budget", QUANTITY * BUYER_CONFIG["walk_away_price"]),
        "max_quantity": BUYER_CONFIG.get("max_quantity", int(QUANTITY * 1.25)),
    }
    buyer = BuyerAgent(config)

    seller_counter: float | None = None
    seller_justification: str | None = None
    seller_quantity: int | None = None
    deal_closed = False

    for _ in range(max_rounds + 1):   # +1 to handle accept on final-offer round
        _line()

        # ── Buyer LLM decides ────────────────────────────────────────────
        decision = buyer.decide(seller_counter, seller_justification, seller_quantity=seller_quantity)

        print(f"  Round {buyer.current_round}/{max_rounds} | "
              f"Buyer → ₹{decision.offer_price:.2f}/unit for {decision.offer_quantity} units "
              f"(Total: ₹{decision.total_outlay:,.2f})")
        print(f"  Buyer says  : \"{decision.message}\"")
        print(f"  [Reasoning] : {decision.internal_reasoning}")

        # ── Buyer walks away (before sending offer) ───────────────────────
        if decision.should_walk_away:
            print(f"\n  BUYER WALKS AWAY — no deal reached.")
            result = decline_offer(session_id)
            print(f"  Status: {result.get('status')}")
            return

        # ── Buyer accepts seller's last counter ───────────────────────────
        if decision.should_accept and seller_counter is not None:
            eff_qty = seller_quantity or QUANTITY
            print(f"\n  BUYER ACCEPTS ₹{seller_counter:.2f}/unit for {eff_qty} units (Total: ₹{(seller_counter * eff_qty):,.2f})")
            result = accept_offer(session_id)
            status = result.get("status")
            print(f"  Status: {status}")
            if result.get("razorpay_short_url"):
                print(f"  [PAYMENT] {result['razorpay_short_url']}")
            elif result.get("final_agreed_price"):
                print(f"  Agreed price: ₹{result['final_agreed_price']}")
            deal_closed = True
            return

        # ── Send buyer's offer to seller API ─────────────────────────────
        # Truncate message to API's 500-char limit (LLM can be verbose)
        buyer_message = decision.message[:497] + "..." if len(decision.message) > 500 else decision.message

        # ── POST /moves with retry-with-backoff on 429 ────────────────────
        resp = None
        for attempt in range(1, MOVE_RETRY_ATTEMPTS + 1):
            resp = requests.post(
                f"{API_BASE}/sessions/{session_id}/moves",
                json={
                    "quantity":        decision.offer_quantity or QUANTITY,
                    "offered_price":   decision.offer_price,
                    "buyer_message":   buyer_message,
                    "accept_last_offer": False,
                },
                headers=HDR_BUYER,
                timeout=45,   # seller LLM call can take up to ~30s
            )
            if resp.status_code == 429:
                wait = MOVE_RETRY_BACKOFF_SEC * attempt
                print(f"  [RATE LIMIT] 429 on /moves — backing off {wait}s "
                      f"(attempt {attempt}/{MOVE_RETRY_ATTEMPTS})...")
                time.sleep(wait)
                continue
            break  # success or non-retryable error

        if resp.status_code != 200:
            _err(f"Move rejected {resp.status_code}", resp.text)
            return

        seller_resp = resp.json()
        status = seller_resp["status"]
        s_counter_qty = seller_resp.get("counter_quantity") or QUANTITY

        print(f"\n  Seller status  : {status}")
        if seller_resp.get("counter_price"):
            c_price = seller_resp['counter_price']
            print(f"  Seller counter : ₹{c_price:.2f} for {s_counter_qty} units (Total: ₹{(c_price * s_counter_qty):,.2f})")
        if seller_resp.get("justification"):
            print(f"  Justification  : {seller_resp['justification']}")
        if seller_resp.get("message"):
            print(f"  Message        : {seller_resp['message']}")

        # ── Terminal states from seller ───────────────────────────────────
        if status == "AGREED":
            print(f"\n  DEAL AGREED at ₹{seller_resp.get('final_agreed_price')}")
            if seller_resp.get("razorpay_short_url"):
                print(f"  [PAYMENT] {seller_resp['razorpay_short_url']}")
            deal_closed = True
            return

        if status in ("REJECTED", "EXPIRED"):
            print(f"\n  Seller ended negotiation: {status}")
            return

        # ── PENDING_APPROVAL — wait for merchant, then re-enter loop ─────
        if status == "PENDING_APPROVAL":
            print(f"\n  Deal escalated for merchant approval.")
            print(f"  Proposed price: ₹{seller_resp.get('counter_price')}")

            merchant_result = wait_for_merchant(session_id)
            merchant_status = merchant_result.get("status")

            if merchant_status == "AGREED":
                print(f"\n  MERCHANT APPROVED. DEAL CLOSED at ₹{merchant_result.get('final_agreed_price')}")
                if merchant_result.get("razorpay_short_url"):
                    print(f"  [PAYMENT] {merchant_result['razorpay_short_url']}")
                deal_closed = True
                return

            if merchant_status in ("REJECTED", "EXPIRED"):
                print(f"\n  Merchant {merchant_status}. No deal.")
                return

            if merchant_status == "IN_PROGRESS":
                merchant_counter = merchant_result.get("counter_price")
                if merchant_counter is None:
                    synced = get_session(session_id)
                    merchant_counter = (
                        synced.get("latest_seller_price")
                        or seller_resp.get("counter_price")
                    )
                print(f"\n  Merchant countered at ₹{merchant_counter}. Buyer resuming...")
                seller_counter = merchant_counter
                seller_quantity = s_counter_qty
                seller_justification = merchant_result.get("message", "Merchant counter-offer")
                buyer.record_round(
                    decision.offer_price, decision.message,
                    seller_counter, seller_justification,
                    buyer_quantity=decision.offer_quantity,
                    seller_quantity=seller_quantity,
                )
                continue

            print(f"  Unexpected status after merchant: {merchant_status}. Syncing...")
            synced = get_session(session_id)
            print(f"  Synced status: {synced['status']}")
            return

        seller_counter = seller_resp.get("counter_price")
        seller_quantity = s_counter_qty
        seller_justification = seller_resp.get("justification") or seller_resp.get("message") or ""
        buyer.record_round(
            decision.offer_price, decision.message,
            seller_counter, seller_justification,
            buyer_quantity=decision.offer_quantity,
            seller_quantity=seller_quantity,
        )
        if status == "FINAL_OFFER":
            final_price = seller_resp.get("counter_price") or seller_counter
            print(f"\n  FINAL OFFER: ₹{final_price:.2f} "
                  f"(walk-away: ₹{config['walk_away_price']:.2f})")

            if final_price <= config["walk_away_price"]:
                print("  Within walk-away — ACCEPTING.")
                result = accept_offer(session_id)
                print(f"  Status: {result.get('status')}")
                if result.get("razorpay_short_url"):
                    print(f"  [PAYMENT] {result['razorpay_short_url']}")
                deal_closed = True
            else:
                print("  Above walk-away — DECLINING.")
                result = decline_offer(session_id)
                print(f"  Status: {result.get('status')}")
            return

        # ── Record round and continue ─────────────────────────────────────
        seller_counter = seller_resp.get("counter_price")
        seller_justification = seller_resp.get("justification", "")
        buyer.record_round(
            decision.offer_price, decision.message,
            seller_counter, seller_justification,
        )

    if not deal_closed:
        print("\n  Buyer exhausted all rounds without agreement.")


# ─────────────────────────────────────────────────────────────────────────
# Step 5 — Replay + Verify (Phase 7 closing punch)
# ─────────────────────────────────────────────────────────────────────────

def replay_session(session_id: str) -> None:
    """Print the full chronological negotiation timeline via GET /sessions/{id}/replay."""
    resp = requests.get(
        f"{API_BASE}/sessions/{session_id}/replay",
        headers=HDR_ADMIN,
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    timeline = data.get("timeline", [])
    _line()
    print(f"  NEGOTIATION REPLAY  ({data.get('total_events')} events)")
    _line("-", 60)
    for entry in timeline:
        price_str = f"  ₹{entry['price']:.2f}" if entry.get("price") is not None else ""
        print(
            f"  [{entry['index']:>2}] {entry['event_type']:<22}  "
            f"{entry.get('from_state', '?'):<18} → {entry.get('to_state', '?'):<18}"
            f"  actor={entry.get('actor','?'):<12}{price_str}"
        )


def verify_audit(session_id: str) -> None:
    """Verify per-entry hash chain via GET /sessions/{id}/verify (Phase 7).

    Also falls back to the legacy /audit endpoint for the summary chain_valid flag.
    """
    # ── /verify — per-entry proof ─────────────────────────────────────────
    resp = requests.get(
        f"{API_BASE}/sessions/{session_id}/verify",
        headers=HDR_ADMIN,
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    entries = data.get("entries", [])
    chain_valid = data.get("chain_valid", False)
    _line()
    print(f"  HASH-CHAIN VERIFICATION  ({data.get('total_entries')} entries)")
    _line("-", 60)
    for e in entries:
        status_icon = "✓" if e["valid"] else "✗ TAMPERED"
        print(
            f"  [{e['index']:>2}] {e['event_type']:<22}  "
            f"{e['logged_at'][:19]}  "
            f"hash={e['recorded_hash'][:12]}...  [{status_icon}]"
        )
    _line("-", 60)
    print(f"  Chain integrity : {'VALID ✓' if chain_valid else 'BROKEN ✗'}")


# ─────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    _line("=")
    print("  A2A NEGOTIATION DEMO — TWO LLM AGENTS")
    print(f"  API    : {API_BASE}")
    print(f"  SKU    : {SKU_CODE}  QTY: {QUANTITY}")
    print(f"  Buyer  : target=₹{BUYER_CONFIG['target_price']} "
          f"| walk-away=₹{BUYER_CONFIG['walk_away_price']} "
          f"| opens=₹{BUYER_CONFIG['opening_offer']}")
    if AUTO_MERCHANT:
        print(f"  Merchant mode : AUTO ({AUTO_MERCHANT_ACTION})")
    else:
        print(f"  Merchant mode : MANUAL (poll every {POLL_INTERVAL_SEC}s, "
              f"timeout {POLL_TIMEOUT_SEC}s)")
    _line("=")
    print()

    try:
        health_check()
        sid, max_rounds = create_session()
        print(f"  max_rounds: {max_rounds}\n")
        run_negotiation(sid, max_rounds)
        # ── Phase 7 closing punch: story first, then proof ────────────────
        replay_session(sid)
        verify_audit(sid)

    except requests.exceptions.ConnectionError:
        _err("Cannot connect", "Is the server running? "
             "Try: uvicorn backend.main:app --port 8000")
        sys.exit(1)
    except requests.exceptions.HTTPError as exc:
        _err(f"HTTP {exc.response.status_code}", exc.response.text)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n  Demo interrupted.")
