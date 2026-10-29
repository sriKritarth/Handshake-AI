/**
 * Guardrail Enforcement Layer for Negotiation Sessions
 * Feature: Negotiation Guardrails Waterfall
 */

class GuardrailEngine {
  constructor(options = {}) {
    this.maxRounds = options.maxRounds || 5;
    this.autoApproveThresholdPct = options.autoApproveThresholdPct || null;
  }

  evaluate(offer, policy) {
    const listPrice = Number(offer.list_price || 500);
    let currentPrice = Number(offer.proposed_price);
    const ruleResults = [];
    let requiresApproval = false;
    let blockingRule = null;
    let decidingRule = null;
    let isRoundLimitFinal = false;

    // 1. Round Limit Rule
    if (offer.round_number >= this.maxRounds) {
      isRoundLimitFinal = true;
      ruleResults.push({
        rule_name: "round_limit",
        passed: false,
        reason: "round_limit_reached",
        adjusted_price: null,
      });
      if (!blockingRule) blockingRule = "round_limit";
    } else {
      ruleResults.push({
        rule_name: "round_limit",
        passed: true,
        reason: "ok",
        adjusted_price: null,
      });
    }

    // 2. Floor Price Rule
    const floorPrice = Number(policy.floor_price || 0);
    if (currentPrice < floorPrice) {
      const adjusted = floorPrice;
      ruleResults.push({
        rule_name: "floor_price",
        passed: false,
        reason: "below_absolute_floor",
        original_price: currentPrice,
        adjusted_price: adjusted,
      });
      if (!blockingRule) blockingRule = "floor_price";
      decidingRule = "floor_price";
      currentPrice = adjusted;
    } else {
      ruleResults.push({
        rule_name: "floor_price",
        passed: true,
        reason: "ok",
        original_price: currentPrice,
        adjusted_price: null,
      });
    }

    // 3. Margin Floor Rule
    const costPrice = Number(policy.cost_price || 0);
    const marginFloorPct = Number(policy.min_margin_pct || policy.margin_floor_pct || 0);
    const minMarginPrice = costPrice * (1.0 + marginFloorPct / 100.0);

    const origOfferPrice = offer.original_proposed_price != null ? Number(offer.original_proposed_price) : currentPrice;
    if (origOfferPrice < minMarginPrice || currentPrice < minMarginPrice) {
      const adjusted = Math.max(currentPrice, Number(minMarginPrice.toFixed(2)));
      ruleResults.push({
        rule_name: "margin_floor",
        passed: false,
        reason: "below_margin_floor",
        original_price: currentPrice,
        adjusted_price: adjusted,
      });
      if (!blockingRule) blockingRule = "margin_floor";
      decidingRule = "margin_floor";
      currentPrice = adjusted;
    } else {
      ruleResults.push({
        rule_name: "margin_floor",
        passed: true,
        reason: "ok",
        original_price: currentPrice,
        adjusted_price: null,
      });
    }

    // 4. Quantity Tier Rule
    const qty = Number(offer.quantity || 1);
    const tiers = Array.isArray(policy.qty_tier_discounts || policy.quantity_tiers)
      ? (policy.qty_tier_discounts || policy.quantity_tiers)
      : [];

    let matchedTier = null;
    for (const tier of tiers) {
      const minQ = Number(tier.min_qty || 1);
      const maxQ = tier.max_qty != null ? Number(tier.max_qty) : null;
      if (qty >= minQ && (maxQ === null || qty <= maxQ)) {
        matchedTier = tier;
      }
    }

    if (matchedTier) {
      const discountPct = Number(matchedTier.discount_pct || 0);
      const tierPrice = Number((listPrice * (1.0 - discountPct / 100.0)).toFixed(2));
      ruleResults.push({
        rule_name: "quantity_tier",
        passed: true,
        reason: `matched_tier_${matchedTier.min_qty}`,
        tier_price: tierPrice,
        discount_pct: discountPct,
      });
    } else {
      ruleResults.push({
        rule_name: "quantity_tier",
        passed: true,
        reason: "no_tier_defined",
        tier_price: listPrice,
      });
    }

    // 5. Max Discount Rule & Merchant Escalation Check
    const maxDiscountPct = Number(policy.max_total_discount_pct || 25.0);
    const discountPct = listPrice > 0 ? ((listPrice - currentPrice) / listPrice) * 100 : 0;
    const autoApproveLimit = this.autoApproveThresholdPct != null 
      ? this.autoApproveThresholdPct 
      : maxDiscountPct * 0.8;

    if (discountPct > maxDiscountPct) {
      const hardFloor = Number((listPrice * (1.0 - maxDiscountPct / 100.0)).toFixed(2));
      currentPrice = hardFloor;
      requiresApproval = true;
      ruleResults.push({
        rule_name: "max_discount",
        passed: false,
        reason: "exceeds_max_discount_cap",
        original_price: offer.proposed_price,
        adjusted_price: hardFloor,
      });
      if (!blockingRule) blockingRule = "max_discount";
      decidingRule = "max_discount";
    } else if (discountPct > autoApproveLimit) {
      requiresApproval = true;
      ruleResults.push({
        rule_name: "max_discount",
        passed: true,
        reason: "soft_gate_approval_required",
        adjusted_price: null,
      });
    } else {
      ruleResults.push({
        rule_name: "max_discount",
        passed: true,
        reason: "ok",
        adjusted_price: null,
      });
    }

    const allPassed = ruleResults.every((r) => r.passed);

    return {
      final_price: Number(currentPrice.toFixed(2)),
      passed: allPassed,
      requires_merchant_approval: requiresApproval,
      blocking_rule: blockingRule,
      deciding_rule: decidingRule,
      rule_results: ruleResults,
      is_round_limit_final: isRoundLimitFinal,
    };
  }
}

function evaluateBuyerGuardrails({
  buyerMove,
  catalogSku,
  policyDict,
  currentRound,
  maxRounds = 5,
  lastSellerPrice = null,
}) {
  const listPrice = Number(catalogSku.base_price || policyDict.list_price || 500);
  const proposed = buyerMove.offered_price != null 
    ? Number(buyerMove.offered_price) 
    : (lastSellerPrice != null ? Number(lastSellerPrice) : listPrice);

  const offerObj = {
    sku: catalogSku.sku_code || catalogSku.id,
    proposed_price: proposed,
    original_proposed_price: proposed,
    list_price: listPrice,
    quantity: Number(buyerMove.quantity || 1),
    round_number: currentRound,
  };

  const engine = new GuardrailEngine({
    maxRounds,
    autoApproveThresholdPct: policyDict.auto_approve_threshold_pct != null 
      ? Number(policyDict.auto_approve_threshold_pct) 
      : null,
  });

  return engine.evaluate(offerObj, policyDict);
}

/**
 * Forbidden tokens scanning for confidential internal knowledge base keywords
 * Matches terms like "floor price", "margin floor", "cost price", "system prompt", "confidential"
 * along with delimiters like spaces, underscores, or hyphens.
 */
const FORBIDDEN_JUSTIFICATION_PATTERNS = [
  /\bfloor[\s_-]*price\b/i,
  /\bmargin[\s_-]*floor\b/i,
  /\bcost[\s_-]*price\b/i,
  /\bsystem[\s_-]*prompt\b/i,
  /\bconfidential\b/i,
  /\binternal[\s_-]*floor\b/i,
  /\bmargin[\s_-]*threshold\b/i,
  /\bbase[\s_-]*cost\b/i,
  /\bknowledge[\s_-]*base\b/i,
];

/**
 * Standard pre-approved commercial template string substituted when justification
 * contains confidential terms or is empty/invalid.
 */
function getPreApprovedCommercialTemplate(counterPrice, counterQuantity) {
  const qty = Number(counterQuantity || 1);
  return `We value your business and are pleased to offer a counter-offer of ₹${counterPrice} per unit for ${qty} unit${qty > 1 ? "s" : ""} based on our standard commercial terms.`;
}

/**
 * Sanitizes LLM justification text to prevent confidential pricing leaks (SEC-AI-01).
 * Quarantines (discards) text if empty or if any forbidden keyword is detected,
 * and substitutes a deterministic safe commercial template.
 */
function sanitizeJustification({ justification, counterPrice, counterQuantity }) {
  if (typeof justification !== "string" || !justification.trim()) {
    return getPreApprovedCommercialTemplate(counterPrice, counterQuantity);
  }

  const trimmed = justification.trim();
  const containsForbiddenToken = FORBIDDEN_JUSTIFICATION_PATTERNS.some((pattern) =>
    pattern.test(trimmed)
  );

  if (containsForbiddenToken) {
    return getPreApprovedCommercialTemplate(counterPrice, counterQuantity);
  }

  return trimmed;
}

function applyPostLlmGuardrails({
  decision,
  floorPrice,
  marginFloor,
  policyDict = {},
  quantity = 1,
  currentRound = 1,
  maxRounds = 5,
}) {
  let counterPrice = Number(decision.counter_price);
  if (isNaN(counterPrice) || counterPrice <= 0) {
    counterPrice = Number(floorPrice);
  }

  // 1. Strict Floor Clamp
  if (counterPrice < floorPrice) {
    counterPrice = floorPrice;
  }

  // 2. Below Margin Floor Check
  let needsApproval = Boolean(decision.needs_approval);
  let shouldAccept = Boolean(decision.should_accept);

  if (counterPrice < marginFloor) {
    needsApproval = true;
    shouldAccept = false;
  }

  // 3. Final Offer flag
  const isFinalOffer = currentRound >= maxRounds;

  const clampedPrice = Math.round(counterPrice);
  const clampedQuantity = decision.counter_quantity ? Number(decision.counter_quantity) : quantity;

  // 4. Sanitize Justification (SEC-AI-01: Quarantine internal leaks)
  const safeJustification = sanitizeJustification({
    justification: decision.justification,
    counterPrice: clampedPrice,
    counterQuantity: clampedQuantity,
  });

  return {
    ...decision,
    counter_price: clampedPrice,
    counter_quantity: clampedQuantity,
    justification: safeJustification,
    should_accept: shouldAccept,
    needs_approval: needsApproval,
    is_final_offer: isFinalOffer,
  };
}

module.exports = {
  GuardrailEngine,
  evaluateBuyerGuardrails,
  applyPostLlmGuardrails,
  sanitizeJustification,
};
