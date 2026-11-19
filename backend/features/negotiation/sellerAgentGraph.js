/**
 * LangGraph.js Negotiation Seller Agent
 * Feature: Autonomous Negotiation Agent with Memory & Toolbox Waterfall Rules
 * Matches Handshake AI HLD:
 * - Toolbox (Waterfall Rules)
 * - Seller Agent (LangGraph + Memory)
 * - Post-Guardrail (Final rules check <-> Merchant Review)
 */

const { StateGraph, END, START, Annotation, MemorySaver } = require("@langchain/langgraph");
const { evaluateBuyerGuardrails, applyPostLlmGuardrails } = require("./guardrails");
const sellerAgent = require("./sellerAgent");
const { getSellerDecision } = sellerAgent;

// Define LangGraph State Schema
const NegotiationState = Annotation.Root({
  sessionId: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => "",
  }),
  currentRound: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => 1,
  }),
  maxRounds: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => 5,
  }),
  buyerOffer: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => ({ offered_price: 0, quantity: 1, message: "" }),
  }),
  catalogSku: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => ({}),
  }),
  pricingPolicy: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => ({}),
  }),
  lastSellerPrice: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),
  waterfallResult: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => ({}),
  }),
  sellerDecision: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => ({}),
  }),
  status: Annotation({
    reducer: (prev, next) => next ?? prev,
    default: () => "IN_PROGRESS",
  }),
  messages: Annotation({
    reducer: (prev, next) => (next ? prev.concat(next) : prev),
    default: () => [],
  }),
});

/**
 * Node 1: Toolbox (Waterfall Rules)
 * Executes deterministic business rules: FloorPrice, MarginFloor, QuantityTier, MaxDiscount
 */
async function toolboxWaterfallNode(state) {
  const { buyerOffer, catalogSku, pricingPolicy, currentRound, maxRounds, lastSellerPrice } = state;

  const waterfallResult = evaluateBuyerGuardrails({
    buyerMove: buyerOffer,
    catalogSku,
    policyDict: pricingPolicy,
    currentRound,
    maxRounds,
    lastSellerPrice,
  });

  return {
    waterfallResult,
  };
}

/**
 * Node 2: Seller Agent (LangGraph + Memory)
 * Uses Groq LLM with conversation history to formulate strategic B2B counter-offer
 */
async function sellerAgentNode(state) {
  const {
    catalogSku,
    pricingPolicy,
    currentRound,
    maxRounds,
    buyerOffer,
    lastSellerPrice,
    messages,
  } = state;

  const decisionFn = sellerAgent.getSellerDecision || getSellerDecision;
  const rawDecision = await decisionFn({
    catalogSku,
    pricingPolicy,
    currentRound,
    maxRounds,
    buyerOfferedPrice: buyerOffer.offered_price,
    buyerQuantity: buyerOffer.quantity,
    buyerMessage: buyerOffer.message,
    lastSellerPrice,
    offerHistory: messages,
  });

  return {
    sellerDecision: rawDecision,
  };
}

/**
 * Conditional Router after Toolbox Waterfall (PERF-AI-01)
 * Evaluates whether Groq LLM node is needed or can be bypassed.
 * - Condition A (Auto-Accept): Buyer offer meets or exceeds list price.
 * - Condition B (Terminal Expiry): Negotiation reached max rounds limit.
 * - Condition C (Negotiation Needed): Offer in negotiation range, proceed to LLM.
 */
function routeAfterWaterfall(state) {
  const { buyerOffer = {}, catalogSku = {}, pricingPolicy = {}, currentRound = 1, maxRounds = 5 } = state;
  const listPrice = Number(catalogSku.base_price);
  const offeredPrice = Number(buyerOffer.offered_price || 0);
  const round = Number(currentRound || 1);
  const maxR = Number(maxRounds || 5);

  // Condition A: Auto-Accept when buyer offer >= list price
  if (offeredPrice >= listPrice) {
    return "post_guardrail";
  }

  // Condition B: Terminal Expiry when round limit reached
  if (round > maxR) {
    return "post_guardrail";
  }

  // Condition C: Active negotiation required
  return "seller_agent";
}

/**
 * Node 3: Post-Guardrail (Final rules check <-> Merchant Review)
 * Enforces hard floor compliance and routes to Merchant Review if rules fail
 */
async function postGuardrailNode(state) {
  const {
    sellerDecision,
    catalogSku,
    pricingPolicy,
    buyerOffer,
    currentRound,
    maxRounds,
    waterfallResult,
    lastSellerPrice,
  } = state;

  const floorPrice = Number(pricingPolicy.floor_price || catalogSku.base_price * 0.7);
  const costPrice = Number(pricingPolicy.cost_price || 0);
  const minMarginPct = Number(pricingPolicy.min_margin_pct || 0);
  const marginFloor = costPrice * (1.0 + minMarginPct / 100.0);

  const listPrice = Number(catalogSku.base_price || pricingPolicy.list_price || 500);
  const offeredPrice = Number(buyerOffer.offered_price || 0);
  const currentRoundNum = Number(currentRound || 1);
  const maxRoundsNum = Number(maxRounds || 5);

  let decisionToApply = sellerDecision;

  // Synthesize deterministic decision if LLM node was bypassed (PERF-AI-01)
  if (!decisionToApply || Object.keys(decisionToApply).length === 0) {
    if (offeredPrice >= listPrice) {
      decisionToApply = {
        counter_price: offeredPrice,
        counter_quantity: buyerOffer.quantity || 1,
        justification: `We are pleased to accept your offer of ₹${offeredPrice} per unit for ${buyerOffer.quantity || 1} units.`,
        internal_reasoning: "Deterministic Auto-Accept: Buyer offer meets or exceeds list price. LLM bypassed.",
        should_accept: true,
        needs_approval: false,
      };
    } else if (currentRoundNum > maxRoundsNum) {
      const finalPrice = lastSellerPrice ? Number(lastSellerPrice) : listPrice;
      decisionToApply = {
        counter_price: finalPrice,
        counter_quantity: buyerOffer.quantity || 1,
        justification: `We have reached the maximum negotiation round limit. Our final offer stands at ₹${finalPrice} per unit.`,
        internal_reasoning: "Deterministic Terminal Expiry: Maximum negotiation rounds reached. LLM bypassed.",
        should_accept: false,
        needs_approval: false,
        is_final_offer: true,
      };
    } else {
      decisionToApply = {
        counter_price: listPrice,
        counter_quantity: buyerOffer.quantity || 1,
        justification: `We can offer ₹${listPrice} per unit for ${buyerOffer.quantity || 1} units.`,
        internal_reasoning: "Deterministic fallback decision.",
        should_accept: false,
        needs_approval: false,
      };
    }
  }

  // 1. Post-Guardrail Clamping
  const finalDecision = applyPostLlmGuardrails({
    decision: decisionToApply,
    floorPrice,
    marginFloor,
    policyDict: pricingPolicy,
    quantity: buyerOffer.quantity,
    currentRound,
    maxRounds,
  });

  const orderQty = Number(buyerOffer.quantity || 1);

  // --- PART B: Inventory Shortage Escalation & Trade Secret Protection ---
  const batchIncentiveRule = waterfallResult?.rule_results?.find(
    (r) => r.rule_name === "batch_liquidation_incentive" && r.passed
  );
  const availableStock = Number(
    catalogSku.inventory_qty ??
    catalogSku.stock_qty ??
    0
  );
  const isQuantityShortage = Boolean(batchIncentiveRule) || (availableStock > 0 && orderQty > availableStock);

  let nextStatus = "IN_PROGRESS";

  if (isQuantityShortage) {
    finalDecision.needs_approval = true;
    finalDecision.should_accept = false;
    finalDecision.justification = 
      "Thank you for your bulk wholesale order. Because your requested volume exceeds our immediate ready-dispatch allocation, we have forwarded your order to our merchant desk for custom volume allocation and fulfillment scheduling. Our team will review the request and update you shortly.";
    finalDecision.internal_reasoning = 
      `Inventory Allocation Alert: Buyer requested ${orderQty} units, which exceeds current ready stock (${availableStock} units). Escalated to merchant for volume procurement and allocation review.`;
    nextStatus = "PENDING_APPROVAL";
  } else {
    // 2. Rule Check for Merchant Escalation
    const hasHeavyLotPolicy = pricingPolicy.heavy_lot_threshold != null;
    const isSmallLotUnderPolicy = hasHeavyLotPolicy && orderQty < Number(pricingPolicy.heavy_lot_threshold);

    if (finalDecision.needs_approval && isSmallLotUnderPolicy) {
      finalDecision.needs_approval = false;
      nextStatus = "IN_PROGRESS";
    } else if (finalDecision.needs_approval) {
      nextStatus = "PENDING_APPROVAL"; // Routed to Merchant Review Desk
    } else if (finalDecision.should_accept) {
      nextStatus = "AGREED";
    } else if (currentRound > maxRounds) {
      nextStatus = "EXPIRED";
    }
  }

  // 3. Append to LangGraph memory
  const newMemory = [
    {
      round_number: currentRound,
      sender: "BUYER",
      proposed_price: buyerOffer.offered_price,
      quantity: buyerOffer.quantity,
      public_justification: buyerOffer.message,
    },
    {
      round_number: currentRound,
      sender: "SELLER_AI",
      proposed_price: finalDecision.counter_price,
      quantity: finalDecision.counter_quantity || buyerOffer.quantity,
      public_justification: finalDecision.justification,
    },
  ];

  return {
    sellerDecision: finalDecision,
    status: nextStatus,
    messages: newMemory,
  };
}

// Build StateGraph with conditional routing
const workflow = new StateGraph(NegotiationState)
  .addNode("toolbox_waterfall", toolboxWaterfallNode)
  .addNode("seller_agent", sellerAgentNode)
  .addNode("post_guardrail", postGuardrailNode)
  .addEdge(START, "toolbox_waterfall")
  .addConditionalEdges("toolbox_waterfall", routeAfterWaterfall, {
    seller_agent: "seller_agent",
    post_guardrail: "post_guardrail",
  })
  .addEdge("seller_agent", "post_guardrail")
  .addEdge("post_guardrail", END);

// Compile with LangGraph in-memory state checkpointer
const memory = new MemorySaver();
const sellerAgentApp = workflow.compile({ checkpointer: memory });

module.exports = {
  sellerAgentApp,
  routeAfterWaterfall,
  toolboxWaterfallNode,
  sellerAgentNode,
  postGuardrailNode,
  NegotiationState,
};
