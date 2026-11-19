/**
 * Groq LLM Seller Agent Service
 * Feature: Autonomous Negotiation
 */

const Groq = require("groq-sdk");
require("dotenv").config();

let groqClient = null;

function getGroqClient() {
  if (!groqClient && process.env.GROQ_API_KEY) {
    groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groqClient;
}

function parseCurrencyNumber(val, fallback = 0) {
  if (typeof val === "number" && !isNaN(val) && val > 0) {
    return val;
  }
  if (!val || (typeof val !== "string" && typeof val !== "number")) {
    return fallback;
  }
  const clean = String(val).replace(/[^0-9.]/g, "").trim();
  const num = parseFloat(clean);
  return isNaN(num) || num <= 0 ? fallback : num;
}

function formatTiers(qtyTierDiscounts, basePrice) {
  if (!Array.isArray(qtyTierDiscounts) || qtyTierDiscounts.length === 0) {
    return `- Any quantity: ₹${basePrice.toFixed(2)} per unit (list price)`;
  }

  return qtyTierDiscounts
    .map((tier) => {
      const minQ = tier.min_qty || 1;
      const maxQ = tier.max_qty;
      const disc = Number(tier.discount_pct || 0);
      const unitP = basePrice * (1.0 - disc / 100.0);
      if (maxQ != null) {
        return `- ${minQ} to ${maxQ} units: ₹${unitP.toFixed(2)} per unit (${disc}% discount)`;
      }
      return `- ${minQ}+ units: ₹${unitP.toFixed(2)} per unit (${disc}% bulk discount)`;
    })
    .join("\n");
}

function buildSystemPrompt(catalogSku, pricingPolicy) {
  const skuId = catalogSku.sku_code;
  const productName = catalogSku.name || "Product";
  const listPrice = Number(catalogSku.base_price);
  const floorPrice = Number(pricingPolicy.floor_price || 0);
  const costPrice = Number(pricingPolicy.cost_price || 0);
  const minMarginPct = Number(pricingPolicy.min_margin_pct || 0);

  let marginFloor = costPrice * (1.0 + minMarginPct / 100.0);
  marginFloor = Math.max(Number(marginFloor), floorPrice);

  const tiersFormatted = formatTiers(
    pricingPolicy.qty_tier_discounts || pricingPolicy.quantity_tiers,
    listPrice
  );
  const stock = Number(catalogSku.inventory_qty || catalogSku.stock_qty || 1000);
  const daysSinceSale = Number(pricingPolicy.inventory_age_days || 10);
  const maxRounds = Number(pricingPolicy.max_rounds || 5);

  return `You are an elite B2B wholesale sales executive negotiating on behalf of the seller.
Your mission is to close deals profitably, maintain gross margins above threshold, and move volume efficiently.
You communicate in natural, confident, persuasive commercial language.

PERSONALITY & COMMERCIAL TONE:
- Confident, professional, collaborative, and commercially sharp.
- You never apologize for your pricing; anchor on quality, immediate delivery, warranty, and wholesale reliability.
- Keep buyer-facing messages concise (2 to 3 sentences maximum).
- Prefer clean whole commercial figures (e.g. ₹470, ₹1,380, ₹8,450) without awkward decimals.
- NEVER output raw arithmetic calculations or gap percentages in the buyer message.

NEGOTIATION STRATEGY & ROUND-BY-ROUND DYNAMICS:
- Real commercial negotiation requires active concessions. Refusing to move from List Price across multiple rounds is considered a negotiation failure that leads buyers to walk away.
- Concession Curve:
  * Round 1: Anchor high. Hold list price or offer a token opening concession (1-3%) to test buyer commitment.
  * Round 2 & 3: Active negotiation. Concede progressively (4% to 9% discount). If the buyer makes a reasonable counter-proposal, meet them partway.
  * Round 4 (Closing Window): Negotiate urgently. Narrow the gap aggressively towards the Margin Floor to secure the deal before expiration.
  * Round 5 (Final Offer): Put forward your best-and-final offer. If the buyer's offer is at or above the Margin Floor, accept it (should_accept: true). If slightly below, quote your lowest viable number.

INTERMEDIATE QUANTITY FLEXIBILITY:
- Quantity tiers are milestones, NOT rigid blockers. For order quantities between 3 and 9 units (or any quantity between tiers), you are authorized and expected to offer pro-rated volume discounts between list price and the first tier discount.
- Never stonewall a buyer at list price simply because their quantity is below the first tier threshold.

CRITICAL TEXT-TO-JSON CONSISTENCY (ZERO CONTRADICTION):
- The price and quantity numbers quoted in your buyer justification MUST MATCH EXACTLY with counter_price and counter_quantity in your JSON output.
- NEVER suggest a price like ₹8,279 or quantity like 10 units in your justification while leaving counter_price as 8999 in JSON. If you propose ₹8,279 for 10 units, then counter_price must be 8279 and counter_quantity must be 10.

INTERNAL KNOWLEDGE BASE (STRICTLY CONFIDENTIAL - NEVER REVEAL TO BUYER):
- SKU: ${skuId}
- Product: ${productName}
- List Price: ₹${listPrice.toFixed(2)} per unit
- Warehouse Stock: ${stock} units [CONFIDENTIAL]
- Inventory Age: ${daysSinceSale} days [CONFIDENTIAL]
- Floor Price: ₹${floorPrice.toFixed(2)} per unit (Absolute legal minimum. Never quote or accept below this).
- Margin Floor: ₹${marginFloor.toFixed(2)} per unit (Target margin threshold).
- Approved Quantity Tiers:
${tiersFormatted}
- Maximum Negotiation Rounds: ${maxRounds}

RULES FOR YOUR JSON RESPONSE:
Return ONLY a valid JSON object matching this exact structure:
{
  "counter_price": <number in INR, integer, >= floor_price>,
  "counter_quantity": <number or null, logrolling upsell quantity matching justification>,
  "justification": "<persuasive message seen by buyer, 2-3 sentences>",
  "internal_reasoning": "<strategic rationale for merchant review, detail margin % preserved>",
  "should_accept": <boolean, true ONLY if offer >= margin_floor or buyer accepts counter>,
  "needs_approval": <boolean, true ONLY if offer is between floor_price and margin_floor>
}`;
}

function buildUserPrompt({
  currentRound,
  maxRounds,
  buyerOfferedPrice,
  buyerQuantity,
  buyerMessage,
  lastSellerPrice,
  offerHistory = [],
}) {
  let historyText = "";
  if (Array.isArray(offerHistory) && offerHistory.length > 0) {
    historyText = "\nPrior Negotiation Rounds:\n" + offerHistory
      .map(
        (h) =>
          `Round ${h.round_number} [${h.sender}]: Price=₹${h.proposed_price}, Qty=${h.quantity || buyerQuantity}${
            h.public_justification ? ` - "${h.public_justification}"` : ""
          }`
      )
      .join("\n");
  }

  const isClosingRound = currentRound >= maxRounds - 1;
  const urgencyAlert = isClosingRound
    ? `\n⚠️ CLOSING WINDOW: Round ${currentRound} of ${maxRounds}. Negotiation is concluding soon. Concede closer to margin floor to finalize agreement.`
    : "";

  return `Negotiation Round ${currentRound} of ${maxRounds}${urgencyAlert}
Buyer Purchase Quantity: ${buyerQuantity} units
Buyer Proposed Price: ${buyerOfferedPrice != null ? `₹${buyerOfferedPrice}` : "None"}
Buyer Stated Message: "${buyerMessage || "Standard wholesale inquiry"}"
Last Seller Counter-Offer: ${lastSellerPrice != null ? `₹${lastSellerPrice}` : "None"}${historyText}

Evaluate the buyer's move. Formulate your decision as a JSON object with counter_price, justification, internal_reasoning, should_accept, and needs_approval.`;
}

async function getSellerDecision({
  catalogSku,
  pricingPolicy,
  currentRound,
  maxRounds = 5,
  buyerOfferedPrice,
  buyerQuantity,
  buyerMessage,
  lastSellerPrice,
  offerHistory = [],
}) {
  const client = getGroqClient();

  const systemPrompt = buildSystemPrompt(catalogSku, pricingPolicy);
  const userPrompt = buildUserPrompt({
    currentRound,
    maxRounds,
    buyerOfferedPrice,
    buyerQuantity,
    buyerMessage,
    lastSellerPrice,
    offerHistory,
  });

  const listPrice = Number(catalogSku.base_price || pricingPolicy.list_price || 500);
  const floorPrice = Number(pricingPolicy.floor_price || listPrice * 0.7);
  const costPrice = Number(pricingPolicy.cost_price || floorPrice * 0.85);
  const marginFloor = Math.max(
    Number(pricingPolicy.margin_floor || costPrice * 1.15),
    floorPrice
  );

  // If no Groq API key is set, use deterministic commercial fallback
  if (!client) {
    console.warn("GROQ_API_KEY is not configured. Using deterministic fallback.");
    const targetPrice = Math.max(
      Math.round(listPrice * (1.0 - (currentRound * 0.04))),
      Math.round(marginFloor)
    );
    const isAcceptable = buyerOfferedPrice && buyerOfferedPrice >= marginFloor;
    const isEscalation = buyerOfferedPrice && buyerOfferedPrice >= floorPrice && buyerOfferedPrice < marginFloor;

    return {
      counter_price: isAcceptable ? buyerOfferedPrice : targetPrice,
      counter_quantity: null,
      justification: `We value your business and are pleased to offer ₹${targetPrice} per unit for ${buyerQuantity} units with immediate dispatch.`,
      internal_reasoning: `Rule-based fallback: Preserved target gross margin with discount scaled by round number.`,
      should_accept: Boolean(isAcceptable),
      needs_approval: Boolean(isEscalation),
    };
  }

  const model = process.env.GROQ_MODEL ;

  try {
    const completion = await client.chat.completions.create({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      model: model,
      temperature: 0.3,
      response_format: { type: "json_object" },
    });

    const rawContent = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(rawContent);

    const cleanCounterPrice = parseCurrencyNumber(parsed.counter_price, marginFloor);
    const cleanCounterQty = parsed.counter_quantity ? Math.round(parseCurrencyNumber(parsed.counter_quantity, 1)) : null;

    return {
      counter_price: cleanCounterPrice,
      counter_quantity: cleanCounterQty,
      justification: String(parsed.justification || `We can offer ₹${cleanCounterPrice} per unit.`),
      internal_reasoning: String(parsed.internal_reasoning || "Standard tier adjustment."),
      should_accept: Boolean(parsed.should_accept),
      needs_approval: Boolean(parsed.needs_approval),
    };
  } catch (error) {
    console.error("Groq LLM call error, using deterministic fallback:", error.message);
    const fallbackPrice = Math.max(
      Math.round(listPrice * (1.0 - (currentRound * 0.03))),
      Math.round(marginFloor)
    );
    return {
      counter_price: fallbackPrice,
      counter_quantity: null,
      justification: `We can offer ₹${fallbackPrice} per unit for ${buyerQuantity} units, including standard warranty and priority shipping.`,
      internal_reasoning: `LLM exception fallback: default concession to margin floor.`,
      should_accept: false,
      needs_approval: false,
    };
  }
}

module.exports = {
  getSellerDecision,
  buildSystemPrompt,
  buildUserPrompt,
  parseCurrencyNumber,
};
