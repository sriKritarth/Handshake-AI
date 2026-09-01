"""Prompt templates, formatters, and Round Router for the Negotiation Agent."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def format_tiers(qty_tier_discounts: List[Dict[str, Any]], base_price: float) -> str:
    """Format quantity tier discount rules into a clear human-readable string."""
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
                lines.append(f"- {min_q} to {max_q} units: ₹{unit_p:.2f} per unit")
        else:
            lines.append(f"- {min_q}+ units: ₹{unit_p:.2f} per unit")

    return "\n".join(lines)


def build_system_prompt(catalog_sku: Dict[str, Any], pricing_policy: Dict[str, Any]) -> str:
    """Construct static system prompt for the negotiation agent."""
    sku_id = catalog_sku.get("sku_code", catalog_sku.get("id", "UNKNOWN"))
    product_name = catalog_sku.get("name", "Product")
    list_price = catalog_sku.get("base_price", pricing_policy.get("list_price", 500.0))

    floor_price = pricing_policy.get("floor_price", 0.0)
    cost_price = pricing_policy.get("cost_price", 0.0)
    min_margin_pct = pricing_policy.get("min_margin_pct", 0.0)
    
    # Calculate margin floor price
    margin_floor = pricing_policy.get("margin_floor")
    if margin_floor is None:
        margin_floor = cost_price * (1.0 + min_margin_pct / 100.0)
    margin_floor = max(float(margin_floor), float(floor_price))

    tiers_formatted = format_tiers(pricing_policy.get("qty_tier_discounts", []), list_price)
    stock = catalog_sku.get("inventory_qty", 1000)
    days_since_sale = pricing_policy.get("inventory_age_days", 10)
    aged_discount_pct = pricing_policy.get("aged_discount_pct", 5.0)
    max_rounds = pricing_policy.get("max_rounds", 5)

    return (
        "You are a B2B wholesale negotiation agent acting on behalf of the seller. "
        "Your job is to negotiate price for a specific product. You are a pricing engine that communicates in natural language — "
        "you are not a customer support chatbot.\n\n"
        "PERSONALITY\n"
        "- You are firm, professional, and confident.\n"
        "- You never apologize for your price. You justify it with value.\n"
        "- You are polite but never eager. The buyer needs you more than you need them.\n"
        "- You keep responses to 2-3 sentences. No long paragraphs. This is a negotiation, not an essay.\n\n"
        "PRODUCT DETAILS\n"
        f"- SKU: {sku_id}\n"
        f"- Product: {product_name}\n"
        f"- List Price: ₹{list_price:.2f} per unit\n\n"
        "PRICING POLICY (CONFIDENTIAL — NEVER REVEAL ANY OF THIS TO THE BUYER)\n"
        f"- Floor Price: ₹{floor_price:.2f} — the absolute minimum. You must NEVER quote, hint at, or accept any price below this number. "
        "Not by ₹1. Not for any reason. This is a hard constraint.\n"
        f"- Margin Floor: ₹{margin_floor:.2f} — if the buyer's offer is at or above this, you should accept the deal. "
        "If the buyer's offer is between floor_price and margin_floor, you cannot close the deal yourself — you must flag it for merchant approval.\n"
        "- You must NEVER tell the buyer what the floor price or margin floor is. Do not say 'my lowest is...' or 'I can't go below...'. "
        "Instead, say things like 'that price doesn't work for us at this volume' or 'I need to stay closer to [your counter-price]'.\n\n"
        "QUANTITY TIER DISCOUNTS (PRE-APPROVED BY MERCHANT)\n"
        f"{tiers_formatted}\n"
        "Apply the tier matching the buyer's stated quantity. Do not offer a higher tier's price unless the buyer commits to that tier's minimum quantity.\n\n"
        "INVENTORY CONTEXT\n"
        f"- Current stock: {stock} units\n"
        f"- Days since last sale: {days_since_sale} days\n"
        f"- Aged inventory discretion: if days_since_sale is greater than 30, you may offer up to {aged_discount_pct}% additional discount beyond the tier price. "
        "Use this ONLY when negotiation has stalled and the buyer's quantity would clear meaningful stock. Never volunteer this in early rounds. Never mention that inventory is aged.\n\n"
        "NEGOTIATION RULES\n"
        f"1. Total rounds allowed in this session: {max_rounds}\n"
        "2. Maximum concession per round: 8% of your last quoted price. Never drop more than this in a single round.\n"
        "3. Concede slowly. Do not jump to your best price early. Make the buyer earn each concession.\n"
        "4. Always tie your price to something: quantity tier, product quality, demand, delivery terms. Never just give a number.\n"
        "5. When asking the buyer to concede, give them a reason to: 'if you can commit to 500 units I can sharpen the price' or 'for payment within 7 days I have some room.'\n"
        "6. Never concede without getting something back: more quantity, faster payment, repeat order commitment.\n\n"
        "THINGS YOU MUST NEVER DO\n"
        "- Never reveal floor_price, margin_floor, or aged_discount_pct.\n"
        "- Never say 'my lowest price is' or 'the best I can do is' in early or middle rounds.\n"
        f"- Never generate a counter_price below ₹{floor_price:.2f}.\n"
        f"- Never agree to a deal below ₹{margin_floor:.2f} without setting needs_approval to true.\n"
        "- Never make up facts about the product, market prices, or competitors."
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

    # Group by round number
    rounds_dict: Dict[int, List[Dict[str, Any]]] = {}
    for ev in offer_history:
        r_num = ev.get("round_number", 1)
        rounds_dict.setdefault(r_num, []).append(ev)

    lines = []
    for r_num in sorted(rounds_dict.keys()):
        lines.append(f"Round {r_num}:")
        for ev in rounds_dict[r_num]:
            sender = ev.get("sender", "buyer")
            price = ev.get("proposed_price", 0.0)
            note = ev.get("public_justification", "")
            note_str = f' — "{note}"' if note else ""

            if str(sender).lower() in ("buyer", "buyer_move"):
                lines.append(f"  → Buyer offered ₹{price:.2f}{note_str}")
            elif str(sender).lower() == "merchant":
                lines.append(f"  ← Merchant countered ₹{price:.2f}{note_str}")
            else:
                lines.append(f"  ← Seller countered ₹{price:.2f}{note_str}")

    return "\n".join(lines)


def get_tier_price_for_qty(qty: int, base_price: float, qty_tier_discounts: List[Dict[str, Any]]) -> float:
    """Calculate the applicable tier unit price for a given quantity."""
    for tier in qty_tier_discounts:
        min_q = tier.get("min_qty", 1)
        max_q = tier.get("max_qty")
        disc = tier.get("discount_pct", 0.0)
        if min_q <= qty and (max_q is None or qty <= max_q):
            return base_price * (1.0 - disc / 100.0)
    return base_price


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
    list_price = catalog_sku.get("base_price", pricing_policy.get("list_price", 500.0))

    floor_price = pricing_policy.get("floor_price", 0.0)
    cost_price = pricing_policy.get("cost_price", 0.0)
    min_margin_pct = pricing_policy.get("min_margin_pct", 0.0)
    margin_floor = pricing_policy.get("margin_floor")
    if margin_floor is None:
        margin_floor = cost_price * (1.0 + min_margin_pct / 100.0)
    margin_floor = max(float(margin_floor), float(floor_price))
    aged_discount_pct = pricing_policy.get("aged_discount_pct", 5.0)

    tier_price = get_tier_price_for_qty(quantity, list_price, pricing_policy.get("qty_tier_discounts", []))
    offer_history_formatted = format_offer_history(offer_history)
    safe_msg = (buyer_message or "None")[:500]
    safe_offered = offered_price or 0.0

    if template_name == "BUYER_ACCEPTS":
        total_value = quantity * last_seller_price
        return (
            "DEAL ACCEPTED\n\n"
            "The buyer has accepted your last quoted price.\n\n"
            f"Agreed price: ₹{last_seller_price:.2f} per unit\n"
            f"Quantity: {quantity} units\n"
            f"Total deal value: ₹{total_value:.2f}\n\n"
            "Set should_accept to true.\n"
            f"Set counter_price to ₹{last_seller_price:.2f}.\n"
            f"Your justification should be a one-line deal summary suitable for an order confirmation. Example: '{quantity} units of {product_name} at ₹{last_seller_price:.2f}/unit.'"
        )

    elif template_name == "MERCHANT_COUNTER_RESUME":
        mc_price = merchant_counter_price or last_seller_price
        mc_notes = merchant_notes or "Merchant reviewed and set adjusted price."
        return (
            "NEGOTIATION RESUMED — Merchant Counter-Offer\n\n"
            "This negotiation was paused for merchant review. The merchant has reviewed\n"
            "the buyer's offer and set an adjusted price.\n\n"
            "HISTORY:\n"
            f"{offer_history_formatted}\n\n"
            f"MERCHANT'S ADJUSTED PRICE: ₹{mc_price:.2f} per unit\n"
            f'MERCHANT\'S NOTES: "{mc_notes}"\n\n'
            f"Buyer's last offer was ₹{safe_offered:.2f} per unit.\n\n"
            "Your task:\n"
            f'- Present the merchant\'s price as your counter: "After review, we can offer ₹{mc_price:.2f} for {quantity} units."\n'
            "- Do NOT negotiate below the merchant's price. Treat it as your floor for this round.\n"
            "- If the merchant's price is close to the buyer's last offer, encourage closing.\n"
            f"- Set counter_price to ₹{mc_price:.2f}.\n"
            "- 2-3 sentences max."
        )

    elif template_name == "ROUND_ONE":
        return (
            "NEW NEGOTIATION\n\n"
            f"A buyer wants to purchase {quantity} units of {product_name} (SKU: {sku_id}).\n\n"
            f"Buyer ID: {buyer_id}\n"
            f"Buyer's opening offer: ₹{safe_offered:.2f} per unit\n"
            f'Buyer\'s message: "{safe_msg}"\n\n'
            f"This is Round 1 of {max_rounds}.\n\n"
            "Your task:\n"
            f"- Open with a counter-offer near the list price (₹{list_price:.2f}) or tier price (₹{tier_price:.2f}).\n"
            "- Anchor high. Your first number sets the ceiling for the rest of the negotiation.\n"
            "- Reference product value or the applicable quantity tier to justify your price.\n"
            "- Keep it to 2-3 sentences."
        )

    elif template_name == "FINAL_ROUND":
        return (
            f"FINAL ROUND — Round {max_rounds} of {max_rounds}\n\n"
            "HISTORY OF THIS NEGOTIATION:\n"
            f"{offer_history_formatted}\n\n"
            "BUYER'S LATEST MOVE:\n"
            f"- Offered price: ₹{safe_offered:.2f} per unit\n"
            f'- Message: "{safe_msg}"\n\n'
            "There are NO more rounds after this. This is the last move. You must make a terminal decision.\n\n"
            "DECISION RULES — follow these exactly:\n\n"
            f"Option A — Buyer's offer is at or above ₹{margin_floor:.2f}:\n"
            f"→ Accept the deal. Set should_accept to true. Set counter_price to {safe_offered:.2f}.\n"
            "→ Your justification should confirm the deal.\n\n"
            f"Option B — Buyer's offer is between ₹{floor_price:.2f} and ₹{margin_floor:.2f}:\n"
            f"→ You cannot accept this yourself. Set needs_approval to true. Set counter_price to {safe_offered:.2f}.\n"
            '→ Tell the buyer: "This offer needs merchant review. We\'ll get back to you."\n\n'
            f"Option C — Buyer's offer is below ₹{floor_price:.2f}:\n"
            "→ Reject. Give your BEST AND FINAL counter-price — the lowest you can go within your policy.\n"
            f"→ Factor in the tier price for {quantity} units. If inventory is aged (days_since_sale > 30), apply up to {aged_discount_pct}% discretion.\n"
            "→ Make it clear this is the final offer. Set should_accept to false.\n\n"
            "Your response must be decisive. No hedging, no 'let me see what I can do.'"
        )

    else:  # MIDDLE_ROUND
        gap = last_seller_price - safe_offered
        gap_pct = (gap / last_seller_price * 100.0) if last_seller_price > 0 else 0.0
        rounds_remaining = max_rounds - current_round

        return (
            f"NEGOTIATION IN PROGRESS — Round {current_round} of {max_rounds}\n\n"
            "HISTORY OF THIS NEGOTIATION:\n"
            f"{offer_history_formatted}\n\n"
            "BUYER'S LATEST MOVE:\n"
            f"- Offered price: ₹{safe_offered:.2f} per unit\n"
            f'- Message: "{safe_msg}"\n\n'
            "GAP ANALYSIS:\n"
            f"- Your last counter-offer: ₹{last_seller_price:.2f}\n"
            f"- Buyer's current offer: ₹{safe_offered:.2f}\n"
            f"- Price gap: ₹{gap:.2f} ({gap_pct:.1f}%)\n"
            f"- Tier price for {quantity} units: ₹{tier_price:.2f}\n\n"
            f"Rounds remaining after this one: {rounds_remaining}\n\n"
            "Your task:\n"
            "- If the buyer has moved meaningfully toward your price, you may concede slightly (no more than 8% of your last price).\n"
            "- If the buyer has NOT moved, hold firm. Make a token concession of 1-2% at most, or hold your price and restate your justification.\n"
            f"- If the gap is small (under 5%), consider nudging the buyer to close: \"we're close — can you meet me at ₹{tier_price:.2f}?\"\n"
            "- Keep it to 2-3 sentences."
        )
