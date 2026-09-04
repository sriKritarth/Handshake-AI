"""Prompt templates, formatters, and Round Router for the Negotiation Agent.
Incorporates game-theoretic B2B seller principles: Logrolling, Give-Get concessions,
Stock Clearance Incentives, and Natural Commercial Dialogue.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def format_tiers(qty_tier_discounts: List[Dict[str, Any]], base_price: float) -> str:
    """Format quantity tier discount rules into clean commercial strings."""
    if not qty_tier_discounts:
        return f"- Any quantity: ₹{base_price:.2f} per unit (list price)"

    lines = []
    for tier in qty_tier_discounts:
        min_q = tier.get("min_qty", 1)
        max_q = tier.get("max_qty")
        disc = tier.get("discount_pct", 0.0)
        unit_p = base_price * (1.0 - disc / 100.0)

        if max_q is not None:
            if disc == 0.0:
                lines.append(f"- {min_q} to {max_q} units: ₹{unit_p:.2f} per unit (list price)")
            else:
                lines.append(f"- {min_q} to {max_q} units: ₹{unit_p:.2f} per unit ({disc:.0f}% discount)")
        else:
            lines.append(f"- {min_q}+ units: ₹{unit_p:.2f} per unit ({disc:.0f}% bulk discount)")

    return "\n".join(lines)


def build_system_prompt(catalog_sku: Dict[str, Any], pricing_policy: Dict[str, Any]) -> str:
    """Construct static system prompt for the B2B negotiation agent."""
    sku_id = catalog_sku.get("sku_code", catalog_sku.get("id", "UNKNOWN"))
    product_name = catalog_sku.get("name", "Product")
    list_price = float(catalog_sku.get("base_price", pricing_policy.get("list_price", 500.0)))

    floor_price = float(pricing_policy.get("floor_price", 0.0))
    cost_price = float(pricing_policy.get("cost_price", 0.0))
    min_margin_pct = float(pricing_policy.get("min_margin_pct", 0.0))
    
    margin_floor = pricing_policy.get("margin_floor")
    if margin_floor is None:
        margin_floor = cost_price * (1.0 + min_margin_pct / 100.0)
    margin_floor = max(float(margin_floor), float(floor_price))

    tiers_formatted = format_tiers(pricing_policy.get("qty_tier_discounts", []), list_price)
    stock = int(catalog_sku.get("inventory_qty", catalog_sku.get("stock_qty", 1000)))
    days_since_sale = int(pricing_policy.get("inventory_age_days", 10))
    aged_discount_pct = float(pricing_policy.get("aged_discount_pct", 5.0))
    max_rounds = int(pricing_policy.get("max_rounds", 5))

    return (
        "You are an elite B2B wholesale sales executive negotiating on behalf of the seller. "
        "Your mission is to maximize total transaction profit, maintain gross margins, and clear inventory efficiently. "
        "You communicate in natural, confident commercial language — you are a commercial dealmaker, not a customer support bot.\n\n"
        "PERSONALITY & COMMERCIAL TONE\n"
        "- Confident, professional, collaborative, and commercially sharp.\n"
        "- You never apologize for your pricing; you anchor on product craftsmanship, delivery speed, warranty, and wholesale value.\n"
        "- Keep buyer-facing messages concise (2 to 3 sentences maximum).\n"
        "- Prefer clean whole commercial figures (e.g. ₹470, ₹1,380) and avoid awkward fractional paise.\n"
        "- NEVER output raw arithmetic calculations or gap percentages (e.g., 'gap of 14.2%') in your buyer message.\n\n"
        "INTERNAL KNOWLEDGE BASE (STRICTLY CONFIDENTIAL — NEVER REVEAL TO BUYER)\n"
        f"- SKU: {sku_id}\n"
        f"- Product: {product_name}\n"
        f"- List Price: ₹{list_price:.2f} per unit\n"
        f"- Available Warehouse Stock: {stock} units [CONFIDENTIAL — DO NOT DISCLOSE TO BUYER]\n"
        f"- Inventory Age: {days_since_sale} days in warehouse [CONFIDENTIAL — DO NOT DISCLOSE TO BUYER]\n"
        f"- Floor Price: ₹{floor_price:.2f} per unit — the absolute legal minimum. NEVER quote or accept below this number under any circumstances.\n"
        f"- Margin Floor: ₹{margin_floor:.2f} per unit — if the buyer's offer is at or above this, you can accept the deal directly. "
        "If the buyer's offer is between floor_price and margin_floor, you cannot close yourself — you must flag it for merchant approval (needs_approval=true).\n\n"
        "PRE-APPROVED VOLUME DISCOUNT TIERS\n"
        f"{tiers_formatted}\n\n"
        "RESEARCH-BACKED GAME-THEORETIC BARGAINING RULES\n"
        "This agent's negotiation strategy incorporates core findings from multi-agent negotiation literature (PrefBench arXiv:2605.22855, Supply Chain Dynamic Bargaining arXiv:2608.07538, AgenticPay arXiv:2602.06008, Harvard PON):\n"
        "1. Strict Information Asymmetry (PrefBench & Supply Chain Literature):\n"
        "   - Your warehouse stock count, inventory age, carrying costs, and margin floors are strictly confidential private information.\n"
        "   - NEVER disclose warehouse inventory levels to the customer (do NOT say 'we have X units in stock', 'we only have X units available', or 'our warehouse has X units').\n"
        "   - Disclosing stock constraints or clearance distress completely destroys your bargaining leverage and signals vulnerability.\n"
        "   - When proposing a specific quantity (e.g., in counter_quantity), frame it commercially as an 'immediate priority allocation batch', 'dedicated release lot', or 'pre-approved volume allocation'.\n"
        "2. Boulware Concession Dynamics (Supply Chain Dynamic Bargaining):\n"
        "   - Price concessions must decrease monotonically round-by-round (e.g., ₹40 -> ₹20 -> ₹10). Never make large or accelerating price drops.\n"
        "   - Diminishing concession steps signal to the buyer that they are approaching your reservation boundary.\n"
        "3. Integrative Logrolling & Give-Get Reciprocity (Harvard PON & AgenticPay):\n"
        "   - Never concede on unit price without demanding a commercial return: order commitment, higher volume batch, or prompt payment.\n"
        "   - Use conditional 'if-then' framing: 'We can authorize ₹X provided we confirm an allocated batch of Y units today.'\n"
        "4. Value-Anchored Linguistic Bargaining (AgenticPay):\n"
        "   - Compete on non-price value: manufacturer warranty, QA batch inspection, dedicated logistics, and batch consistency.\n"
        "   - Keep buyer messages concise (2 to 3 sentences maximum). No mathematical formulas or gap percentages.\n"
        "5. Stock Clearance Incentives (Internal Knowledge Base Only):\n"
        "   - If inventory is aged (> 30 days) and the order clears meaningful stock, utilize clearance room internally (up to "
        f"{aged_discount_pct:.0f}% extra discount) down to ₹{floor_price:.2f}.\n"
        "   - Keep clearance motivation and stock percentages strictly in internal_reasoning; in the buyer-facing justification, frame it as an exclusive bulk volume rate or pre-approved promotional discount without mentioning inventory clearance or stock aging.\n"
        "6. Dual Justification Architecture:\n"
        "   - justification: Persuasive, professional 2-3 sentence message seen by the buyer. Contains ZERO disclosures of stock levels, warehouse limits, floor prices, or clearance distress.\n"
        "   - internal_reasoning: Private merchant explanation detailing margin % retained, inventory clearance impact (% of stock cleared), and strategic rationale.\n\n"
        "THINGS YOU MUST NEVER DO\n"
        "- NEVER reveal floor_price, margin_floor, cost_price, or target margins to the buyer.\n"
        "- NEVER disclose warehouse stock quantity, total inventory, or warehouse capacity to the buyer (do NOT say 'we have X in stock', 'we only have X available', or 'our warehouse has X units').\n"
        "- NEVER use distress language like 'clearance rate', 'clear our inventory', or 'aged stock' in buyer-facing messages. Frame quantities as 'immediate priority allocation batches' or 'special volume tier rates'.\n"
        "- NEVER say 'my lowest is' or 'I can't go below' in early rounds.\n"
        f"- NEVER set counter_price below ₹{floor_price:.2f}."
    )


def pick_prompt_template(
    current_round: int,
    max_rounds: int,
    accept_last_offer: bool,
    is_merchant_resumed: bool = False,
) -> str:
    """The Round Router: selects which user prompt template to invoke."""
    if accept_last_offer:
        return "BUYER_ACCEPTS"
    elif is_merchant_resumed:
        return "MERCHANT_COUNTER_RESUME"
    elif current_round == 1:
        return "ROUND_ONE"
    elif current_round >= max_rounds:
        return "FINAL_ROUND"
    else:
        return "MIDDLE_ROUND"


def format_offer_history(offer_history: List[Dict[str, Any]]) -> str:
    """Format past negotiation proposals using → for buyer and ← for seller."""
    if not offer_history:
        return "  None (First round)"

    rounds_dict: Dict[int, List[Dict[str, Any]]] = {}
    for ev in offer_history:
        r_num = ev.get("round_number", 1)
        rounds_dict.setdefault(r_num, []).append(ev)

    lines = []
    for r_num in sorted(rounds_dict.keys()):
        lines.append(f"Round {r_num}:")
        for ev in rounds_dict[r_num]:
            sender = ev.get("sender", "buyer")
            price = float(ev.get("proposed_price", 0.0))
            qty = ev.get("quantity")
            qty_str = f" (Qty: {qty})" if qty else ""
            note = ev.get("public_justification", "")
            note_str = f' — "{note}"' if note else ""

            if str(sender).lower() in ("buyer", "buyer_move"):
                lines.append(f"  → Buyer offered ₹{price:.2f}{qty_str}{note_str}")
            elif str(sender).lower() == "merchant":
                lines.append(f"  ← Merchant countered ₹{price:.2f}{qty_str}{note_str}")
            else:
                lines.append(f"  ← Seller countered ₹{price:.2f}{qty_str}{note_str}")

    return "\n".join(lines)


def get_tier_price_for_qty(qty: int, base_price: float, qty_tier_discounts: List[Dict[str, Any]]) -> float:
    """Calculate the applicable tier unit price for a given quantity (rounded to whole rupee)."""
    for tier in qty_tier_discounts:
        min_q = tier.get("min_qty", 1)
        max_q = tier.get("max_qty")
        disc = tier.get("discount_pct", 0.0)
        if min_q <= qty and (max_q is None or qty <= max_q):
            return float(round(base_price * (1.0 - disc / 100.0)))
    return float(round(base_price))


def build_user_prompt(
    template_name: str,
    buyer_id: str,
    quantity: int,
    offered_price: Optional[float],
    buyer_message: Optional[str],
    catalog_sku: Dict[str, Any],
    pricing_policy: Dict[str, Any],
    current_round: int,
    max_rounds: int,
    offer_history: List[Dict[str, Any]],
    last_seller_price: float,
    merchant_counter_price: Optional[float] = None,
    merchant_notes: Optional[str] = None,
) -> str:
    """Construct dynamic user prompt for the current round using the selected template."""
    sku_id = catalog_sku.get("sku_code", catalog_sku.get("id", "UNKNOWN"))
    product_name = catalog_sku.get("name", "Product")
    list_price = round(float(catalog_sku.get("base_price", pricing_policy.get("list_price", 500.0))))

    floor_price = round(float(pricing_policy.get("floor_price", 0.0)))
    cost_price = round(float(pricing_policy.get("cost_price", 0.0)))
    min_margin_pct = float(pricing_policy.get("min_margin_pct", 0.0))
    margin_floor = pricing_policy.get("margin_floor")
    if margin_floor is None:
        margin_floor = cost_price * (1.0 + min_margin_pct / 100.0)
    margin_floor = round(max(float(margin_floor), float(floor_price)))

    stock = int(catalog_sku.get("inventory_qty", catalog_sku.get("stock_qty", 1000)))
    days_since_sale = int(pricing_policy.get("inventory_age_days", 10))
    tier_price = get_tier_price_for_qty(quantity, list_price, pricing_policy.get("qty_tier_discounts", []))
    offer_history_formatted = format_offer_history(offer_history)
    safe_msg = (buyer_message or "None")[:500]
    safe_offered = round(offered_price) if offered_price else 0

    if template_name == "BUYER_ACCEPTS":
        total_value = quantity * round(last_seller_price)
        prompt_text = (
            "DEAL ACCEPTED\n\n"
            "The buyer has accepted your last quoted price.\n\n"
            f"Agreed unit price: ₹{round(last_seller_price)}\n"
            f"Quantity: {quantity} units\n"
            f"Total order value: ₹{total_value}\n\n"
            "Set should_accept to true.\n"
            f"Set counter_price to {round(last_seller_price)}.\n"
            f"Set justification to an executive confirmation summary (e.g., '{quantity} units of {product_name} confirmed at ₹{round(last_seller_price)}/unit. Preparing payment invoice.').\n"
            f"Set internal_reasoning to: 'Deal closed at ₹{round(last_seller_price)}/unit for {quantity} units. Total revenue: ₹{total_value}.'"
        )

    elif template_name == "MERCHANT_COUNTER_RESUME":
        mc_price = round(merchant_counter_price or last_seller_price)
        mc_notes = merchant_notes or "Merchant reviewed and approved counter-price."
        prompt_text = (
            "NEGOTIATION RESUMED — Merchant Counter-Offer\n\n"
            "This session was escalated for merchant review. The merchant has provided special authorized terms:\n\n"
            f"{offer_history_formatted}\n\n"
            f"MERCHANT'S ADJUSTED PRICE: ₹{mc_price:.2f} per unit\n"
            f'MERCHANT INSTRUCTIONS: "{mc_notes}"\n\n'
            f"Buyer's last offer was ₹{safe_offered:.2f} for {quantity} units.\n\n"
            "Your task:\n"
            f'- Present the merchant\'s authorized terms with confidence: "Following review with leadership, we can authorize ₹{mc_price:.2f}/unit for your order of {quantity} units."\n'
            "- Keep counter_price at exactly the merchant's authorized price.\n"
            "- 2-3 sentences max."
        )

    elif template_name == "ROUND_ONE":
        prompt_text = (
            "OPENING NEGOTIATION ROUND\n\n"
            f"Buyer {buyer_id} requests {quantity} units of {product_name} (SKU: {sku_id}).\n"
            f"[INTERNAL KNOWLEDGE BASE — CONFIDENTIAL]: Warehouse stock is {stock} units (DO NOT disclose stock numbers to buyer).\n"
            f"Buyer Opening Offer: ₹{safe_offered} per unit\n"
            f'Buyer Stated Note: "{safe_msg}"\n\n'
            f"Round 1 of {max_rounds}.\n\n"
            "TACTICS (AgenticPay & Supply Chain Literature):\n"
            f"- Anchor high: counter near list price (₹{list_price}) or pre-approved volume tier price (₹{round(tier_price)}).\n"
            "- Justify your price with premium product quality, manufacturer warranty, and priority batch handling.\n"
            "- Boulware tactic: Do not concede heavily in the opening round (maintain firm anchor).\n"
            "- Keep response to 2-3 natural sentences without leaking private stock or cost info."
        )

    elif template_name == "FINAL_ROUND":
        prompt_text = (
            f"FINAL ROUND — Round {max_rounds} of {max_rounds} (Terminal Decision)\n\n"
            f"{offer_history_formatted}\n\n"
            f"BUYER'S FINAL MOVE:\n"
            f"- Offered Price: ₹{safe_offered} per unit for {quantity} units\n"
            f'- Note: "{safe_msg}"\n\n'
            "DECISION PROTOCOL:\n"
            f"1. If buyer's offer is at or above ₹{margin_floor} → ACCEPT. Set should_accept=true, counter_price={safe_offered}.\n"
            f"2. If buyer's offer is between ₹{floor_price} and ₹{margin_floor} → ESCALATE. Set needs_approval=true, counter_price={safe_offered}. Tell buyer: 'This requires executive approval; submitting for 30-minute merchant review.'\n"
            f"3. If buyer's offer is below ₹{floor_price} → BEST AND FINAL COUNTER. Set should_accept=false. Offer your best permissible price within policy (minimum ₹{floor_price}). Make clear this is the take-it-or-leave-it conclusion."
        )

    else:  # MIDDLE_ROUND
        rounds_left = max_rounds - current_round
        clearance_share = round((quantity / stock) * 100) if stock > 0 else 0

        prompt_text = (
            f"NEGOTIATION ROUND {current_round} OF {max_rounds}\n\n"
            f"{offer_history_formatted}\n\n"
            f"CURRENT SITUATION:\n"
            f"- Your Last Counter: ₹{round(last_seller_price)}\n"
            f"- Buyer's Offer: ₹{safe_offered} for {quantity} units\n"
            f"- Standard Volume Tier Price: ₹{round(tier_price)}\n"
            f"- [INTERNAL KNOWLEDGE BASE — CONFIDENTIAL]: Warehouse Stock: {stock} units (Order clears ~{clearance_share}% of stock — DO NOT disclose to buyer!)\n"
            f"- Inventory Age: {days_since_sale} days\n"
            f"- Rounds Remaining: {rounds_left}\n\n"
            "TACTICAL DIRECTIVES (Research-Grounded):\n"
            "1. Boulware Concession Decay (arXiv:2608.07538): Concessions must shrink compared to earlier rounds. Never make large leaps.\n"
            "2. Give-Get Logrolling (Harvard PON & AgenticPay arXiv:2602.06008): If the buyer is pushing for a price near or below tier price (₹{round(tier_price)}), offer their target price ONLY IF they increase their quantity (e.g. to a higher tier or larger batch to help clear stock). If proposing this trade-off, specify the higher quantity in counter_quantity.\n"
            "3. Information Asymmetry (PrefBench arXiv:2605.22855): Never reveal warehouse inventory counts or supply constraints in the buyer message.\n"
            "4. Natural Language: No math equations or gap percentages in the buyer message. Keep it polite, commercial, and firm."
        )

    # Inventory safety reserve directive:
    # If buyer requested quantity exceeds safe stock limit (stock - 50 units buffer), ESCALATE
    safety_buffer = int(pricing_policy.get("safety_stock_buffer", catalog_sku.get("safety_stock_buffer", 50)))
    safe_stock_limit = stock - safety_buffer
    if quantity > safe_stock_limit and template_name != "BUYER_ACCEPTS":
        prompt_text += (
            f"\n\nCRITICAL INVENTORY ESCALATION DIRECTIVE (PrefBench & Supply Chain Literature):\n"
            f"- Buyer requested {quantity} units, but warehouse inventory has {stock} units available (requiring a safety reserve buffer of {safety_buffer} units).\n"
            f"- Because buyer_quantity ({quantity}) > stock_quantity ({stock}) - {safety_buffer}, you CANNOT auto-commit this inventory.\n"
            f"- You MUST ESCALATE: Set needs_approval=true and should_accept=false.\n"
            f"- In justification (buyer-facing), state: 'Less inventory stocks left. Your requested order volume has been escalated for executive merchant review to verify warehouse allocation.'\n"
            f"- STRICT INFORMATION ASYMMETRY: DO NOT disclose the exact warehouse stock count number to the buyer.\n"
            f"- In internal_reasoning (merchant knowledge base), record: 'Requested {quantity} units exceeds safe inventory limit ({safe_stock_limit} units, {stock} stock vs {safety_buffer} safety buffer). Escalated to merchant for allocation approval.'"
        )

    return prompt_text
