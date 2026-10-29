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
  const skuId = catalogSku.sku_code || catalogSku.id || "UNKNOWN";
  const productName = catalogSku.name || "Product";
  const listPrice = Number(catalogSku.base_price || pricingPolicy.list_price || 500);
  const floorPrice = Number(pricingPolicy.floor_price || 0);
  const costPrice = Number(pricingPolicy.cost_price || 0);
  const minMarginPct = Number(pricingPolicy.min_margin_pct || 0);

  let marginFloor = pricingPolicy.margin_floor;
  if (marginFloor == null) {
    marginFloor = costPrice * (1.0 + minMarginPct / 100.0);
  }
  marginFloor = Math.max(Number(marginFloor), floorPrice);

  const tiersFormatted = formatTiers(
    pricingPolicy.qty_tier_discounts || pricingPolicy.quantity_tiers,
    listPrice
  );
  const stock = Number(catalogSku.inventory_qty || catalogSku.stock_qty || 1000);
  const daysSinceSale = Number(pricingPolicy.inventory_age_days || 10);
  const maxRounds = Number(pricingPolicy.max_rounds || 5);

  return `You are an elite B2B wholesale sales executive negotiating on behalf of the seller.
Your mission is to maximize total transaction profit, maintain gross margins, and clear inventory efficiently.
You communicate in natural, confident commercial language.

PERSONALITY & COMMERCIAL TONE:
- Confident, professional, collaborative, and commercially sharp.
- You never apologize for your pricing; anchor on quality, delivery speed, warranty, and wholesale value.
- Keep buyer-facing messages concise (2 to 3 sentences maximum).
- Prefer clean whole commercial figures (e.g. ₹470, ₹1,380) without awkward decimals.
- NEVER output raw arithmetic calculations or gap percentages in the buyer message.

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
  "counter_quantity": <number or null, logrolling upsell quantity>,
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

  return `Negotiation Round ${currentRound} of ${maxRounds}
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

  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  try {
    const completion = await client.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const rawContent = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(rawContent);

    return {
      counter_price: Number(parsed.counter_price || marginFloor),
      counter_quantity: parsed.counter_quantity ? Number(parsed.counter_quantity) : null,
      justification: String(parsed.justification || `We can offer ₹${parsed.counter_price} per unit.`),
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
};
