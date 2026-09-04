"""Streamlit Frontend for B2B Wholesale Negotiation Agent.

Full interactive web dashboard connecting to the FastAPI backend (main.py):
- Sidebar: API Key management (Admin, Buyer, Merchant), backend base URL, and health check.
- Modes:
    1. Human-to-Agent (H2A): Human buyer interacts and bargains with AI seller.
    2. Agent-to-Agent (A2A): Autonomous Groq LLM Buyer Agent vs Seller Agent.
    3. Merchant Desk: Review & resolve escalated deals (PENDING_APPROVAL).
    4. Replay & Audit: Visual chronological timeline and cryptographic hash-chain verification.
- Integrated with Razorpay checkout settlement page.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import requests
import streamlit as st
import yaml
from dotenv import load_dotenv

# Ensure root is in sys.path
_ROOT = Path(__file__).resolve().parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

load_dotenv(_ROOT / ".env", override=True)

# ---------------------------------------------------------------------------
# Page Configuration & Styling
# ---------------------------------------------------------------------------
st.set_page_config(
    page_title="Handshake AI — B2B Negotiation Agent",
    page_icon="🤝",
    layout="wide",
    initial_sidebar_state="expanded",
)

st.markdown(
    """
    <style>
    .main-title {
        font-size: 2.2rem;
        font-weight: 800;
        background: linear-gradient(90deg, #10b981, #3b82f6);
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        margin-bottom: 0.2rem;
    }
    .sub-title {
        font-size: 1rem;
        color: #94a3b8;
        margin-bottom: 1.5rem;
    }
    .metric-box {
        background-color: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        padding: 12px;
        text-align: center;
    }
    .chat-bubble-buyer {
        background-color: #1e3a8a;
        color: #f1f5f9;
        border-radius: 12px;
        padding: 12px 16px;
        margin-bottom: 10px;
        border-left: 4px solid #3b82f6;
    }
    .chat-bubble-seller {
        background-color: #064e3b;
        color: #f1f5f9;
        border-radius: 12px;
        padding: 12px 16px;
        margin-bottom: 10px;
        border-left: 4px solid #10b981;
    }
    .status-badge {
        display: inline-block;
        padding: 4px 10px;
        font-weight: 700;
        font-size: 0.85rem;
        border-radius: 6px;
    }
    .status-agreed { background-color: #065f46; color: #6ee7b7; border: 1px solid #059669; }
    .status-progress { background-color: #1e3a8a; color: #93c5fd; border: 1px solid #2563eb; }
    .status-pending { background-color: #78350f; color: #fde68a; border: 1px solid #d97706; }
    .status-rejected { background-color: #7f1d1d; color: #fca5a5; border: 1px solid #dc2626; }
    </style>
    """,
    unsafe_allow_html=True,
)

# ---------------------------------------------------------------------------
# Catalog Loader
# ---------------------------------------------------------------------------
@st.cache_data
def load_catalog() -> List[Dict[str, Any]]:
    catalog_path = _ROOT / "data" / "catalog.yaml"
    if catalog_path.exists():
        with open(catalog_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or []
    return []

CATALOG = load_catalog()
CATALOG_BY_SKU = {item["sku"]: item for item in CATALOG if "sku" in item}

# ---------------------------------------------------------------------------
# Session State Initialization
# ---------------------------------------------------------------------------
if "admin_key" not in st.session_state:
    st.session_state.admin_key = os.getenv("ADMIN_KEY", "")
if "buyer_key" not in st.session_state:
    st.session_state.buyer_key = os.getenv("BUYER_KEY", "")
if "merchant_key" not in st.session_state:
    st.session_state.merchant_key = os.getenv("MERCHANT_KEY", "")
if "api_base" not in st.session_state:
    st.session_state.api_base = os.getenv("API_BASE", "http://localhost:8000/api/v1")

# Negotiation session states
if "h2a_session_id" not in st.session_state:
    st.session_state.h2a_session_id = None
if "h2a_session_data" not in st.session_state:
    st.session_state.h2a_session_data = None
if "h2a_history" not in st.session_state:
    st.session_state.h2a_history = []

if "a2a_logs" not in st.session_state:
    st.session_state.a2a_logs = []
if "a2a_session_id" not in st.session_state:
    st.session_state.a2a_session_id = None
if "a2a_status" not in st.session_state:
    st.session_state.a2a_status = None

# ---------------------------------------------------------------------------
# API Client Helper Functions
# ---------------------------------------------------------------------------
def get_headers(role: str = "buyer") -> Dict[str, str]:
    """Resolve HTTP request headers with the correct API key."""
    if st.session_state.get("use_admin_for_all", False) and st.session_state.admin_key:
        key = st.session_state.admin_key
    elif role == "admin":
        key = st.session_state.admin_key
    elif role == "merchant":
        key = st.session_state.merchant_key or st.session_state.admin_key
    else:
        key = st.session_state.buyer_key or st.session_state.admin_key

    headers = {"Content-Type": "application/json"}
    if key:
        headers["X-API-Key"] = key
    return headers


def api_request(method: str, path: str, role: str = "buyer", **kwargs) -> requests.Response:
    """Execute API request against the configured backend."""
    base = st.session_state.api_base.rstrip("/")
    url = f"{base}{path}" if path.startswith("/") else f"{base}/{path}"
    headers = get_headers(role)
    if "headers" in kwargs:
        headers.update(kwargs.pop("headers"))
    return requests.request(method, url, headers=headers, **kwargs)


# ---------------------------------------------------------------------------
# SIDEBAR: API Keys & Configuration
# ---------------------------------------------------------------------------
with st.sidebar:
    st.image("https://img.icons8.com/isometric/100/handshake.png", width=60)
    st.markdown("### **Handshake AI Settings**")
    st.caption("Agent-to-Agent & Human B2B Wholesale Platform")

    st.divider()
    st.markdown("#### 🔑 **API Key Vault**")
    st.caption("Keys are stored securely in `st.session_state`.")

    admin_key_input = st.text_input(
        "Admin Key (All Scopes)",
        value=st.session_state.admin_key,
        type="password",
        help="Required for session creation, audit, and admin endpoints.",
    )
    buyer_key_input = st.text_input(
        "Buyer Key (Negotiate, Accept, Decline)",
        value=st.session_state.buyer_key,
        type="password",
        help="Used by buyer agent or human buyer for submitting moves.",
    )
    merchant_key_input = st.text_input(
        "Merchant Key (Approve, Counter, Reject)",
        value=st.session_state.merchant_key,
        type="password",
        help="Used by merchant dashboard to resolve escalated deals.",
    )

    use_admin_for_all = st.checkbox(
        "Use Admin Key for all requests",
        value=True,
        help="The seeded admin-demo key has admin, buyer, and audit scopes.",
    )
    st.session_state.use_admin_for_all = use_admin_for_all

    if st.button("💾 Save Keys", use_container_width=True):
        st.session_state.admin_key = admin_key_input
        st.session_state.buyer_key = buyer_key_input
        st.session_state.merchant_key = merchant_key_input
        st.success("API keys updated in session state!")

    st.divider()
    st.markdown("#### 🌐 **Backend Connectivity**")
    api_base_input = st.text_input(
        "API Base URL",
        value=st.session_state.api_base,
        help="FastAPI server endpoint (defaults to http://localhost:8000/api/v1)",
    )
    st.session_state.api_base = api_base_input

    # Health check button
    if st.button("🩺 Check Server Health", use_container_width=True):
        try:
            resp = requests.get(f"{st.session_state.api_base.rstrip('/')}/health", timeout=3)
            if resp.status_code == 200:
                data = resp.json()
                st.success(f"Online: {data.get('engine')} (Phase {data.get('phase')})")
            else:
                st.error(f"HTTP {resp.status_code}: {resp.text}")
        except Exception as exc:
            st.error(f"Connection Failed: {exc}")

    st.divider()
    st.markdown("#### 🧭 **Navigation Mode**")
    mode = st.radio(
        "Select Workflow:",
        [
            "🤝 Human-to-Agent (H2A)",
            "🤖 Agent-to-Agent (A2A)",
            "🛡️ Merchant Desk",
            "📜 Replay & Audit Verification",
        ],
        index=0,
    )

    st.divider()
    st.caption("⚡ Powered by FastAPI, Supabase, Groq & Razorpay")


# ---------------------------------------------------------------------------
# HEADER
# ---------------------------------------------------------------------------
st.markdown('<div class="main-title">Handshake AI — B2B Negotiation Platform</div>', unsafe_allow_html=True)
st.markdown(
    '<div class="sub-title">B2B Wholesale Price Negotiation Engine with Dynamic Guardrails and Automated Settlement</div>',
    unsafe_allow_html=True,
)

# ---------------------------------------------------------------------------
# HELPER: Status Badge
# ---------------------------------------------------------------------------
def render_status_badge(status: str) -> str:
    status_lower = (status or "UNKNOWN").upper()
    if status_lower == "AGREED":
        return f'<span class="status-badge status-agreed">✓ {status_lower}</span>'
    elif status_lower in ("IN_PROGRESS", "FINAL_OFFER"):
        return f'<span class="status-badge status-progress">🔄 {status_lower}</span>'
    elif status_lower == "PENDING_APPROVAL":
        return f'<span class="status-badge status-pending">⚠️ {status_lower}</span>'
    else:
        return f'<span class="status-badge status-rejected">✗ {status_lower}</span>'


# ===========================================================================
# MODE 1: HUMAN-TO-AGENT (H2A)
# ===========================================================================
if mode == "🤝 Human-to-Agent (H2A)":
    st.subheader("🤝 Human-to-Agent Wholesale Negotiation")
    st.write(
        "You are the procurement buyer. Negotiate bulk pricing directly with the AI Seller Agent. "
        "The agent dynamically enforces pricing tiers, margin floors, and inventory buffer rules."
    )

    col_setup, col_chat = st.columns([1, 2])

    with col_setup:
        st.markdown("#### 🛒 1. Configure Order")

        sku_options = list(CATALOG_BY_SKU.keys()) if CATALOG_BY_SKU else ["TSH-PREM-001", "AUD-HDPH-001", "JAC-LEATH-001"]
        selected_sku = st.selectbox(
            "Select Product / SKU",
            options=sku_options,
            index=0,
            format_func=lambda s: f"{s} — {CATALOG_BY_SKU.get(s, {}).get('name', '')}" if s in CATALOG_BY_SKU else s,
        )

        product_meta = CATALOG_BY_SKU.get(selected_sku, {})
        list_price = float(product_meta.get("list_price", 1000))

        st.info(
            f"**Product**: {product_meta.get('name', selected_sku)}\n\n"
            f"**List Price (MRP)**: ₹{list_price:,.2f}\n\n"
            f"**Category**: {product_meta.get('category', 'wholesale').title()}\n\n"
            f"_{product_meta.get('description', '')}_"
        )

        h2a_qty = st.number_input("Order Quantity (units)", min_value=1, max_value=1000, value=50, step=1)
        h2a_buyer_id = st.text_input("Buyer Company ID", value="procurement-buyer-001")

        if st.button("🚀 Start Negotiation Session", use_container_width=True, type="primary"):
            try:
                resp = api_request(
                    "POST",
                    "/sessions",
                    role="admin",
                    json={
                        "buyer_id": h2a_buyer_id,
                        "sku_code": selected_sku,
                        "quantity": h2a_qty,
                        "channel": "CHAT",
                    },
                    timeout=15,
                )
                if resp.status_code == 201:
                    data = resp.json()
                    st.session_state.h2a_session_id = data["session_id"]
                    st.session_state.h2a_session_data = data
                    st.session_state.h2a_history = []
                    st.success(f"Session started! ID: {data['session_id']}")
                    st.rerun()
                else:
                    st.error(f"Failed to create session: {resp.status_code} — {resp.text}")
            except Exception as exc:
                st.error(f"Error connecting to backend: {exc}")

        if st.session_state.h2a_session_id:
            st.divider()
            st.markdown(f"**Active Session**: `{st.session_state.h2a_session_id}`")
            if st.button("🔄 Sync Session State", use_container_width=True):
                try:
                    resp = api_request("GET", f"/sessions/{st.session_state.h2a_session_id}", role="buyer")
                    if resp.status_code == 200:
                        st.session_state.h2a_session_data = resp.json()
                        st.rerun()
                except Exception as e:
                    st.error(f"Sync error: {e}")

            if st.button("🗑️ Reset Session", use_container_width=True):
                st.session_state.h2a_session_id = None
                st.session_state.h2a_session_data = None
                st.session_state.h2a_history = []
                st.rerun()

    with col_chat:
        st.markdown("#### 💬 2. Negotiation Dialogue")

        if not st.session_state.h2a_session_id:
            st.info("👈 Select a product and click **Start Negotiation Session** to begin.")
        else:
            s_data = st.session_state.h2a_session_data or {}
            curr_status = s_data.get("status", "IN_PROGRESS")
            curr_round = s_data.get("current_round", 1)

            # Metrics row
            m1, m2, m3, m4 = st.columns(4)
            with m1:
                st.markdown(f"**Status**: {render_status_badge(curr_status)}", unsafe_allow_html=True)
            with m2:
                st.metric("Round", f"{curr_round} / 5")
            with m3:
                last_seller = s_data.get("latest_seller_price")
                st.metric("Seller Offer", f"₹{last_seller:,.2f}" if last_seller else "—")
            with m4:
                last_buyer = s_data.get("latest_buyer_price")
                st.metric("Your Last Offer", f"₹{last_buyer:,.2f}" if last_buyer else "—")

            st.divider()

            # Chat history container
            chat_box = st.container()
            with chat_box:
                if not st.session_state.h2a_history:
                    st.caption("No moves yet. Submit your opening proposal below.")

                for msg in st.session_state.h2a_history:
                    m_price = msg.get('price')
                    p_text = f"₹{m_price:,.2f}" if m_price is not None else "—"
                    if msg["role"] == "buyer":
                        st.markdown(
                            f"""
                            <div class="chat-bubble-buyer">
                                <b>👤 You (Buyer) — Offered {p_text} / unit</b><br>
                                {msg.get('message', '')}
                            </div>
                            """,
                            unsafe_allow_html=True,
                        )
                    else:
                        st.markdown(
                            f"""
                            <div class="chat-bubble-seller">
                                <b>🤖 Seller Agent — Counter: {p_text} / unit</b><br>
                                {msg.get('justification', '')}<br>
                                <small style="color:#a7f3d0;">Status: {msg.get('status')} | Round: {msg.get('round')}</small>
                            </div>
                            """,
                            unsafe_allow_html=True,
                        )

            st.divider()

            # Action controls depending on status
            if curr_status == "AGREED":
                final_price = s_data.get("final_agreed_price") or s_data.get("latest_seller_price") or 0.0
                total_val = final_price * (s_data.get("quantity") or h2a_qty)
                st.success(
                    f"### 🎉 Deal Closed!\n\n"
                    f"**Agreed Unit Price**: ₹{final_price:,.2f}\n\n"
                    f"**Total Order Value**: ₹{total_val:,.2f} ({s_data.get('quantity') or h2a_qty} units)"
                )
                checkout_url = f"http://localhost:8000/api/v1/checkout/{st.session_state.h2a_session_id}"
                st.link_button(
                    "💳 Proceed to Razorpay Checkout Settlement",
                    url=checkout_url,
                    type="primary",
                    use_container_width=True,
                )

            elif curr_status == "PENDING_APPROVAL":
                st.warning(
                    "⚠️ **Order Volume Escalated for Merchant Review!**\n\n"
                    "The seller agent cannot autonomously approve this allocation because fulfilling it exceeds the warehouse safety reserve buffer. "
                    "The merchant must review and decide via the **Merchant Desk** tab."
                )

            elif curr_status in ("REJECTED", "EXPIRED", "WALKED_AWAY"):
                st.error(f"Negotiation terminated in status: **{curr_status}**.")

            else:
                # Active negotiation form
                with st.form("buyer_move_form", clear_on_submit=False):
                    f1, f2 = st.columns([1, 2])
                    with f1:
                        offer_val = st.number_input(
                            "Your Proposed Price (₹/unit)",
                            min_value=1.0,
                            max_value=list_price * 2,
                            value=float(last_seller or list_price * 0.8),
                            step=10.0,
                        )
                    with f2:
                        buyer_msg = st.text_input(
                            "Strategic Commercial Message",
                            value="We are procuring for immediate delivery with upfront payment terms. Can you meet our target rate?",
                        )

                    c_submit, c_accept, c_decline = st.columns([2, 2, 2])
                    with c_submit:
                        submit_btn = st.form_submit_button("📤 Submit Counter-Offer", type="primary", use_container_width=True)
                    with c_accept:
                        accept_btn = st.form_submit_button("🤝 Accept Seller Offer", use_container_width=True)
                    with c_decline:
                        decline_btn = st.form_submit_button("🚶 Walk Away", use_container_width=True)

                # Process moves
                if submit_btn:
                    with st.spinner("Seller Agent evaluating offer and consulting guardrails..."):
                        try:
                            resp = api_request(
                                "POST",
                                f"/sessions/{st.session_state.h2a_session_id}/moves",
                                role="buyer",
                                json={
                                    "quantity": h2a_qty,
                                    "offered_price": float(offer_val),
                                    "buyer_message": buyer_msg,
                                    "accept_last_offer": False,
                                },
                                timeout=45,
                            )
                            if resp.status_code == 200:
                                res_data = resp.json()
                                st.session_state.h2a_history.append({
                                    "role": "buyer",
                                    "price": float(offer_val),
                                    "message": buyer_msg,
                                })
                                st.session_state.h2a_history.append({
                                    "role": "seller",
                                    "price": res_data.get("counter_price"),
                                    "justification": res_data.get("justification") or res_data.get("message"),
                                    "status": res_data.get("status"),
                                    "round": res_data.get("round"),
                                })
                                # Sync updated session state
                                sync_resp = api_request("GET", f"/sessions/{st.session_state.h2a_session_id}", role="buyer")
                                if sync_resp.status_code == 200:
                                    st.session_state.h2a_session_data = sync_resp.json()
                                st.rerun()
                            else:
                                st.error(f"Move failed: {resp.status_code} — {resp.text}")
                        except Exception as e:
                            st.error(f"API call error: {e}")

                elif accept_btn:
                    with st.spinner("Submitting acceptance to seller..."):
                        try:
                            resp = api_request(
                                "POST",
                                f"/sessions/{st.session_state.h2a_session_id}/accept",
                                role="buyer",
                                timeout=20,
                            )
                            if resp.status_code == 200:
                                res_data = resp.json()
                                st.session_state.h2a_history.append({
                                    "role": "buyer",
                                    "price": s_data.get("latest_seller_price", 0.0),
                                    "message": "Accepted seller's counter-offer.",
                                })
                                sync_resp = api_request("GET", f"/sessions/{st.session_state.h2a_session_id}", role="buyer")
                                if sync_resp.status_code == 200:
                                    st.session_state.h2a_session_data = sync_resp.json()
                                st.success("Offer accepted successfully!")
                                st.rerun()
                            else:
                                st.error(f"Accept failed: {resp.status_code} — {resp.text}")
                        except Exception as e:
                            st.error(f"Error: {e}")

                elif decline_btn:
                    with st.spinner("Closing session..."):
                        try:
                            resp = api_request(
                                "POST",
                                f"/sessions/{st.session_state.h2a_session_id}/decline",
                                role="buyer",
                                timeout=15,
                            )
                            if resp.status_code == 200:
                                sync_resp = api_request("GET", f"/sessions/{st.session_state.h2a_session_id}", role="buyer")
                                if sync_resp.status_code == 200:
                                    st.session_state.h2a_session_data = sync_resp.json()
                                st.warning("Walked away from negotiation.")
                                st.rerun()
                            else:
                                st.error(f"Decline failed: {resp.status_code} — {resp.text}")
                        except Exception as e:
                            st.error(f"Error: {e}")


# ===========================================================================
# MODE 2: AGENT-TO-AGENT (A2A)
# ===========================================================================
elif mode == "🤖 Agent-to-Agent (A2A)":
    st.subheader("🤖 Autonomous Agent-to-Agent (A2A) Negotiation")
    st.write(
        "Two autonomous AI agents negotiate wholesale terms: an LLM Buyer Agent with hidden target/walk-away preferences "
        "and the FastAPI AI Seller Agent operating under strict information asymmetry and margin guardrails."
    )

    col_conf, col_exec = st.columns([1, 2])

    with col_conf:
        st.markdown("#### 🎯 Buyer Agent Strategy")

        a2a_sku = st.selectbox(
            "Product / SKU",
            options=list(CATALOG_BY_SKU.keys()) if CATALOG_BY_SKU else ["TSH-PREM-001"],
            index=0,
            key="a2a_sku_select",
        )
        prod = CATALOG_BY_SKU.get(a2a_sku, {})
        mrp = float(prod.get("list_price", 1499))
        st.caption(f"**Item**: {prod.get('name', a2a_sku)} | **MRP**: ₹{mrp:,.2f}")

        a2a_qty = st.number_input("Quantity", min_value=1, max_value=500, value=50, step=1, key="a2a_qty_val")
        a2a_target = st.number_input("Target Price (₹)", min_value=1.0, value=float(round(mrp * 0.75)), step=10.0)
        a2a_walkaway = st.number_input("Walk-away Price (₹)", min_value=1.0, value=float(round(mrp * 0.88)), step=10.0)
        a2a_opening = st.number_input("Opening Anchor Offer (₹)", min_value=1.0, value=float(round(mrp * 0.65)), step=10.0)
        a2a_max_rounds = st.slider("Max Negotiation Rounds", min_value=1, max_value=5, value=5)

        st.divider()
        st.markdown("#### ⚙️ Escalation Handling")
        auto_merchant = st.checkbox("Auto-resolve Merchant Approvals (Demo Mode)", value=True)
        merchant_decision = st.selectbox("Auto-Merchant Decision", options=["approve", "reject", "counter"], index=0)
        merchant_counter = st.number_input("Counter Price (if countering)", value=float(round(mrp * 0.82)), step=10.0)

        start_a2a_btn = st.button("🚀 Launch A2A Negotiation", type="primary", use_container_width=True)

    with col_exec:
        st.markdown("#### 📊 Autonomous Negotiation Stream")

        if start_a2a_btn:
            st.session_state.a2a_logs = []
            st.session_state.a2a_session_id = None
            st.session_state.a2a_status = None

            status_placeholder = st.empty()
            progress_bar = st.progress(0.0)
            logs_container = st.container()

            # Step 1: Create session
            status_placeholder.info("Creating negotiation session on backend...")
            try:
                resp = api_request(
                    "POST",
                    "/sessions",
                    role="admin",
                    json={
                        "buyer_id": "ai-buyer-agent-001",
                        "sku_code": a2a_sku,
                        "quantity": a2a_qty,
                        "channel": "CHAT",
                    },
                    timeout=15,
                )
                if resp.status_code != 201:
                    status_placeholder.error(f"Failed to create session: {resp.status_code} — {resp.text}")
                    st.stop()

                sess_data = resp.json()
                sid = sess_data["session_id"]
                st.session_state.a2a_session_id = sid
                status_placeholder.success(f"Session Created: `{sid}` | Initiating Buyer Agent...")
            except Exception as e:
                status_placeholder.error(f"Backend error: {e}")
                st.stop()

            # Step 2: Initialize Buyer Agent
            buyer_config = {
                "product_name": prod.get("name", a2a_sku),
                "sku_code": a2a_sku,
                "quantity": a2a_qty,
                "list_price": mrp,
                "target_price": a2a_target,
                "walk_away_price": a2a_walkaway,
                "opening_offer": a2a_opening,
                "max_rounds": a2a_max_rounds,
            }

            try:
                from demo.buyer_agent.agent import BuyerAgent
                buyer = BuyerAgent(buyer_config)
            except Exception as e:
                status_placeholder.error(f"Failed to load BuyerAgent (check GROQ_API_KEY): {e}")
                st.stop()

            seller_counter = None
            seller_justification = None
            deal_reached = False

            # Loop over rounds
            for r in range(1, a2a_max_rounds + 2):
                progress_bar.progress(min(r / a2a_max_rounds, 1.0))

                with logs_container:
                    st.markdown(f"##### ── Round {r} ──")

                # Buyer decision
                try:
                    decision = buyer.decide(seller_counter, seller_justification)
                except Exception as exc:
                    st.error(f"Buyer LLM error: {exc}")
                    break

                with logs_container:
                    st.markdown(
                        f"""
                        <div class="chat-bubble-buyer">
                            <b>🤖 Buyer LLM (Offer: ₹{decision.offer_price:,.2f})</b><br>
                            <i>"{decision.message}"</i><br>
                            <small style="color:#cbd5e1;"><b>Reasoning</b>: {decision.internal_reasoning}</small>
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )

                # Check if buyer walks away
                if decision.should_walk_away:
                    with logs_container:
                        st.warning("🚶 Buyer decided to walk away. Ending negotiation.")
                    api_request("POST", f"/sessions/{sid}/decline", role="buyer")
                    st.session_state.a2a_status = "DECLINED"
                    break

                # Check if buyer accepts seller's counter
                if decision.should_accept and seller_counter is not None:
                    with logs_container:
                        st.success(f"🤝 Buyer accepts seller's counter at ₹{seller_counter:,.2f}!")
                    accept_resp = api_request("POST", f"/sessions/{sid}/accept", role="buyer")
                    st.session_state.a2a_status = "AGREED"
                    deal_reached = True
                    break

                # Send move to backend
                b_msg = decision.message[:497] + "..." if len(decision.message) > 500 else decision.message
                move_resp = api_request(
                    "POST",
                    f"/sessions/{sid}/moves",
                    role="buyer",
                    json={
                        "quantity": a2a_qty,
                        "offered_price": decision.offer_price,
                        "buyer_message": b_msg,
                        "accept_last_offer": False,
                    },
                    timeout=45,
                )

                if move_resp.status_code != 200:
                    with logs_container:
                        st.error(f"Move failed: {move_resp.status_code} — {move_resp.text}")
                    break

                s_resp = move_resp.json()
                s_status = s_resp.get("status")
                s_counter = s_resp.get("counter_price")
                s_just = s_resp.get("justification") or s_resp.get("message")
                counter_str = f"₹{s_counter:,.2f}" if s_counter is not None else "—"

                with logs_container:
                    st.markdown(
                        f"""
                        <div class="chat-bubble-seller">
                            <b>🤖 Seller Agent (Status: {s_status} | Counter: {counter_str})</b><br>
                            {s_just}
                        </div>
                        """,
                        unsafe_allow_html=True,
                    )

                # Terminal checks
                if s_status == "AGREED":
                    st.session_state.a2a_status = "AGREED"
                    deal_reached = True
                    break
                elif s_status in ("REJECTED", "EXPIRED"):
                    st.session_state.a2a_status = s_status
                    break
                elif s_status == "PENDING_APPROVAL":
                    with logs_container:
                        st.warning("⚠️ Seller escalated deal for merchant review.")
                    if auto_merchant:
                        with logs_container:
                            st.info(f"Auto-merchant executing '{merchant_decision}'...")
                        m_payload = {"action": merchant_decision}
                        if merchant_decision == "counter":
                            m_payload["counter_price"] = merchant_counter
                        m_res = api_request("POST", f"/sessions/{sid}/merchant-decision", role="merchant", json=m_payload)
                        if m_res.status_code == 200:
                            m_data = m_res.json()
                            if m_data.get("status") == "AGREED":
                                st.session_state.a2a_status = "AGREED"
                                deal_reached = True
                                break
                            elif m_data.get("status") == "IN_PROGRESS":
                                seller_counter = m_data.get("counter_price") or merchant_counter
                                seller_justification = "Merchant Counter-Offer"
                                buyer.record_round(decision.offer_price, decision.message, seller_counter, seller_justification)
                                continue
                    else:
                        st.session_state.a2a_status = "PENDING_APPROVAL"
                        break

                seller_counter = s_counter
                seller_justification = s_just or ""
                buyer.record_round(decision.offer_price, decision.message, seller_counter, seller_justification)
                time.sleep(1)

            progress_bar.progress(1.0)
            if deal_reached or st.session_state.a2a_status == "AGREED":
                status_placeholder.success(f"🎉 **DEAL AGREED!** Settlement Link Generated.")
                checkout_link = f"http://localhost:8000/api/v1/checkout/{st.session_state.a2a_session_id}"
                st.link_button("💳 Open Razorpay Settlement Page", url=checkout_link, type="primary", use_container_width=True)
            else:
                status_placeholder.warning(f"Negotiation ended with status: **{st.session_state.a2a_status}**")


# ===========================================================================
# MODE 3: MERCHANT DESK
# ===========================================================================
elif mode == "🛡️ Merchant Desk":
    st.subheader("🛡️ Executive Merchant Decision & Review Desk")
    st.write(
        "Review and resolve wholesale deals that triggered guardrail escalations "
        "(`PENDING_APPROVAL`), such as safety stock buffer deficits or margin threshold exceptions."
    )

    m_sid_input = st.text_input(
        "Enter Session ID to Review",
        value=st.session_state.h2a_session_id or st.session_state.a2a_session_id or "",
        help="Paste a session ID in PENDING_APPROVAL status.",
    )

    col_m1, col_m2 = st.columns([1, 1])

    with col_m1:
        if st.button("📥 Fetch Session Details", use_container_width=True):
            if not m_sid_input:
                st.error("Please enter a Session ID.")
            else:
                try:
                    resp = api_request("GET", f"/sessions/{m_sid_input}", role="merchant")
                    if resp.status_code == 200:
                        st.session_state.merchant_session_data = resp.json()
                        st.success("Session details loaded.")
                    else:
                        st.error(f"Failed to fetch: {resp.status_code} — {resp.text}")
                except Exception as e:
                    st.error(f"Network error: {e}")

        m_data = st.session_state.get("merchant_session_data")
        if m_data:
            st.markdown(f"#### Session: `{m_data.get('session_id')}`")
            st.markdown(f"**Status**: {render_status_badge(m_data.get('status'))}", unsafe_allow_html=True)
            st.write(f"**SKU**: `{m_data.get('sku_code')}`")
            st.write(f"**Requested Quantity**: `{m_data.get('quantity')}` units")
            lb_val = m_data.get('latest_buyer_price')
            ls_val = m_data.get('latest_seller_price')
            st.write(f"**Latest Buyer Offer**: {f'₹{lb_val:,.2f}' if lb_val is not None else '—'}")
            st.write(f"**Latest Seller Counter**: {f'₹{ls_val:,.2f}' if ls_val is not None else '—'}")

    with col_m2:
        if m_data and m_data.get("status") == "PENDING_APPROVAL":
            st.markdown("#### ⚖️ Executive Decision")
            m_action = st.radio("Select Action:", ["approve", "reject", "counter"], horizontal=True)

            m_counter_price = None
            if m_action == "counter":
                m_counter_price = st.number_input("Merchant Counter Price (₹/unit)", min_value=1.0, value=1000.0, step=10.0)

            m_notes = st.text_area("Merchant Internal Notes", value="Approved after executive inventory check.")

            if st.button("Submit Executive Decision", type="primary", use_container_width=True):
                payload = {"action": m_action, "merchant_notes": m_notes}
                if m_action == "counter" and m_counter_price:
                    payload["counter_price"] = float(m_counter_price)

                try:
                    resp = api_request(
                        "POST",
                        f"/sessions/{m_data.get('session_id')}/merchant-decision",
                        role="merchant",
                        json=payload,
                    )
                    if resp.status_code == 200:
                        st.success(f"Decision '{m_action.upper()}' recorded successfully!")
                        # Refresh
                        sync_r = api_request("GET", f"/sessions/{m_data.get('session_id')}", role="merchant")
                        if sync_r.status_code == 200:
                            st.session_state.merchant_session_data = sync_r.json()
                            st.rerun()
                    else:
                        st.error(f"Decision failed: {resp.status_code} — {resp.text}")
                except Exception as e:
                    st.error(f"Error: {e}")
        elif m_data:
            st.info(f"Session is in state **{m_data.get('status')}**. No pending approval required.")


# ===========================================================================
# MODE 4: REPLAY & AUDIT VERIFICATION
# ===========================================================================
elif mode == "📜 Replay & Audit Verification":
    st.subheader("📜 Negotiation Replay & Cryptographic Hash-Chain Verification")
    st.write(
        "Inspect the complete audit story of any negotiation session. "
        "Verifies every event's SHA-256 hash against its parent in the tamper-evident chain."
    )

    audit_sid = st.text_input(
        "Session ID",
        value=st.session_state.h2a_session_id or st.session_state.a2a_session_id or "",
        help="Session ID to inspect",
    )

    if st.button("🔍 Fetch Replay & Verify Chain", type="primary"):
        if not audit_sid:
            st.error("Please provide a Session ID.")
        else:
            with st.spinner("Fetching cryptographic verification & timeline replay..."):
                try:
                    # 1. Replay timeline
                    replay_resp = api_request("GET", f"/sessions/{audit_sid}/replay", role="admin")
                    # 2. Verify chain
                    verify_resp = api_request("GET", f"/sessions/{audit_sid}/verify", role="admin")

                    if replay_resp.status_code == 200 and verify_resp.status_code == 200:
                        replay_data = replay_resp.json()
                        verify_data = verify_resp.json()

                        # Verification summary
                        chain_valid = verify_data.get("chain_valid", False)
                        tot = verify_data.get("total_entries", 0)

                        if chain_valid:
                            st.success(f"### 🛡️ Cryptographic Proof: Chain Integrity VALID ({tot} Events)")
                        else:
                            st.error(f"### ⚠️ TAMPER DETECTED: Chain Integrity BROKEN ({tot} Events)")

                        st.divider()

                        # Replay timeline
                        st.markdown("#### 🎬 Chronological Event Timeline")
                        timeline = replay_data.get("timeline", [])
                        if not timeline:
                            st.info("No events recorded for this session yet.")
                        else:
                            for ev in timeline:
                                p_str = f" | **Price**: ₹{ev['price']:,.2f}" if ev.get("price") is not None else ""
                                st.markdown(
                                    f"**Event #{ev['index']}** — `{ev['event_type']}` | "
                                    f"**State**: `{ev.get('from_state', '?')}` → `{ev.get('to_state', '?')}` | "
                                    f"**Actor**: `{ev.get('actor', '?')}`{p_str} "
                                    f"| <small style='color:#94a3b8;'>{ev['logged_at'][:19]}</small>",
                                    unsafe_allow_html=True,
                                )

                        st.divider()

                        # Per-entry verification table
                        st.markdown("#### 🔐 Per-Entry Hash Verification Table")
                        entries = verify_data.get("entries", [])
                        table_data = []
                        for e in entries:
                            table_data.append({
                                "#": e["index"],
                                "Event": e["event_type"],
                                "Logged At": e["logged_at"][:19],
                                "Expected Hash": e["expected_hash"][:16] + "...",
                                "Recorded Hash": e["recorded_hash"][:16] + "...",
                                "Status": "✓ VALID" if e["valid"] else "✗ TAMPERED",
                            })
                        st.dataframe(table_data, use_container_width=True)

                    else:
                        st.error(f"Failed to fetch audit data: Replay={replay_resp.status_code}, Verify={verify_resp.status_code}")
                except Exception as e:
                    st.error(f"Error: {e}")
