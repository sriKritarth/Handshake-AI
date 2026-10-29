/**
 * Negotiation Session Domain Service (Pure JavaScript / Express)
 * Feature: Autonomous Negotiation
 */

const crypto = require("crypto");
const supabase = require("../../config/db");
const { evaluatePreGuardrail } = require("../guardrails/preGuardrail");
const { sellerAgentApp } = require("./sellerAgentGraph");
const { createSettlementOrder } = require("../payments/paymentService");

class NegotiationService {
  /**
   * Helper to fetch SKU and associated pricing policy from Supabase
   */
  async getSkuandPolicy(skuCode) {
    const { data: sku, error: skuError } = await supabase
      .from("catalog_skus")
      .select("*")
      .eq("sku_code", skuCode)
      .maybeSingle();

    if (skuError || !sku) {
      throw new Error(`SKU '${skuCode}' not found in catalog.`);
    }

    const { data: policy } = await supabase
      .from("pricing_policies")
      .select("*")
      .or(`sku_id.eq.${sku.id},sku_code.eq.${sku.sku_code}`)
      .maybeSingle();

     ;

    return {sku , policy} ;
  }

  /**
   * Start a new negotiation session
   */
  async createSession({ buyerId, skuCode, quantity = 1, channel = "CHAT" }) {
    const {sku}  = await this.getSkuandPolicy(skuCode);
    const sessionId = crypto.randomUUID();
    const listPrice = Number(sku.base_price);

    // Initial seller list offer
    const openingPrice = listPrice;

    // 1. Create negotiation_sessions record
    const { data: session, error: sessError } = await supabase
      .from("negotiation_sessions")
      .insert({
        id: sessionId,
        sku_id: sku.id,
        buyer_id: String(buyerId),
        channel: channel,
        status: "IN_PROGRESS",
        current_round: 1,
      })
      .select()
      .single();

    if (sessError) {
      throw new Error(`Failed to create negotiation session: ${sessError.message}`);
    }

    // 2. Insert initial SELLER_AI offer event
    await supabase.from("offer_events").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      round_number: 1,
      sender: "SELLER_AI",
      quantity: quantity,
      proposed_price: openingPrice,
      guardrail_clamped_price: openingPrice,
      is_rule_passed: true,
      public_justification: `Welcome to Handshake AI wholesale procurement. Our listed wholesale catalog price for ${sku.name} is ₹${openingPrice} per unit. Make an offer to begin negotiation.`,
    });

    return {
      session_id: sessionId,
      sku_code: sku.sku_code,
      status: "IN_PROGRESS",
      current_round: 1,
      max_rounds: 5,
      seller_proposed_price: openingPrice,
      quantity: quantity,
      draft_justification: `Wholesale starting offer: ₹${openingPrice} per unit.`,
      created_at: session.created_at,
    };
  }

  /**
   * Process incoming buyer move (Counter or Accept)
   */
  async processBuyerMove({ sessionId, buyerId, offeredPrice, quantity = 1, buyerMessage = "", acceptLastOffer = false }) {
    // 1. Fetch Session with SKU and Offer Events
    const { data: session, error: sessError } = await supabase
      .from("negotiation_sessions")
      .select(`
        *,
        catalog_skus (*),
        offer_events (*)
      `)
      .eq("id", sessionId)
      .maybeSingle();

    if (sessError || !session) {
      throw new Error("Negotiation session not found.");
    }

    if (["AGREED", "REJECTED", "EXPIRED", "PAID"].includes(session.status)) {
      throw new Error(`Session is already in terminal state '${session.status}'.`);
    }

    const sku = session.catalog_skus;
    const {policy}  = await this.getSkuandPolicy(sku.sku_code);
    const maxRounds = (policy?.max_rounds || 5);

    // Sort past offer events
    const sortedEvents = (session.offer_events || []).sort((a, b) => a.round_number - b.round_number);
    const latestSellerEvent = [...sortedEvents].reverse().find((e) => ["SELLER_AI", "SELLER_GUARDRAIL", "MERCHANT"].includes(e.sender));
    const lastSellerPrice = latestSellerEvent ? Number(latestSellerEvent.proposed_price) : Number(sku.base_price);

    // 2. Case: Buyer accepts seller's previous offer
    if (acceptLastOffer) {
      const agreedPrice = lastSellerPrice;
      const totalAmount = agreedPrice * quantity;

      // Update session to AGREED
      await supabase
        .from("negotiation_sessions")
        .update({
          status: "AGREED",
          final_agreed_price: agreedPrice,
        })
        .eq("id", sessionId);

      // Record buyer acceptance event
      await supabase.from("offer_events").insert({
        id: crypto.randomUUID(),
        session_id: sessionId,
        round_number: session.current_round,
        sender: "BUYER",
        quantity: quantity,
        proposed_price: agreedPrice,
        guardrail_clamped_price: agreedPrice,
        is_rule_passed: true,
        public_justification: buyerMessage || "Buyer agreed to seller counter-offer.",
      });

      // Direct payment settlement creation
      const settlement = await createSettlementOrder({
        sessionId,
        amount: totalAmount,
        skuCode: sku.sku_code,
        productName: sku.name,
        quantity,
        unitPrice: agreedPrice,
      });

      return {
        session_id: sessionId,
        sku_code: sku.sku_code,
        status: "AGREED",
        current_round: session.current_round,
        max_rounds: maxRounds,
        final_agreed_price: agreedPrice,
        amount: totalAmount,
        amount_paise: settlement.amount_paise,
        checkout_url: settlement.checkout_url,
        message: "Deal successfully agreed! Direct settlement order created.",
      };
    }

    // 3. Case: Buyer makes a counter-offer
    const nextRound = session.current_round + 1;
    const buyerOffer = Number(offeredPrice);

    // HLD Step: Pre-Guardrail (Injection, PII, off-topic)
    const preCheck = evaluatePreGuardrail(buyerMessage);
    if (!preCheck.passed) {
      return {
        session_id: sessionId,
        sku_code: sku.sku_code,
        status: session.status,
        current_round: session.current_round,
        max_rounds: maxRounds,
        guardrail_warning: preCheck.reason,
        message: `Security Notice: ${preCheck.reason}`,
      };
    }

    // Record BUYER move event in Supabase
    await supabase.from("offer_events").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      round_number: nextRound,
      sender: "BUYER",
      quantity: quantity,
      proposed_price: buyerOffer,
      guardrail_clamped_price: buyerOffer,
      is_rule_passed: true,
      public_justification: preCheck.sanitizedMessage,
    });

    // HLD Step: Seller Agent (LangGraph + Memory) <-> Toolbox (Waterfall Rules) <-> Post-Guardrail
    const graphState = await sellerAgentApp.invoke(
      {
        sessionId,
        currentRound: nextRound,
        maxRounds,
        buyerOffer: {
          offered_price: buyerOffer,
          quantity,
          message: preCheck.sanitizedMessage,
        },
        catalogSku: sku,
        pricingPolicy: policy,
        lastSellerPrice,
        messages: sortedEvents,
      },
      { configurable: { thread_id: sessionId } }
    );

    const { sellerDecision: finalDecision, status: graphStatus } = graphState;

    // HLD Step: Post-Guardrail -> Merchant Review (Only if rules fail)
    if (graphStatus === "PENDING_APPROVAL") {
      await supabase
        .from("negotiation_sessions")
        .update({
          status: "PENDING_APPROVAL",
          current_round: nextRound,
        })
        .eq("id", sessionId);

      await supabase.from("merchant_approvals").insert({
        id: crypto.randomUUID(),
        session_id: sessionId,
        requested_price: buyerOffer,
        status: "PENDING",
        notes: finalDecision.internal_reasoning || "Post-guardrail margin rule flagged for merchant review.",
      });

      return {
        session_id: sessionId,
        sku_code: sku.sku_code,
        status: "PENDING_APPROVAL",
        current_round: nextRound,
        max_rounds: maxRounds,
        message: "Your offer has been escalated to merchant review for volume margin approval.",
      };
    }

    // HLD Step: Deal agreed? -> Yes -> Session State AGREED -> Payment Direct checkout
    if (graphStatus === "AGREED") {
      const agreedPrice = buyerOffer;
      const totalAmount = agreedPrice * quantity;

      await supabase
        .from("negotiation_sessions")
        .update({
          status: "AGREED",
          final_agreed_price: agreedPrice,
          current_round: nextRound,
        })
        .eq("id", sessionId);

      await supabase.from("offer_events").insert({
        id: crypto.randomUUID(),
        session_id: sessionId,
        round_number: nextRound,
        sender: "SELLER_AI",
        quantity: quantity,
        proposed_price: agreedPrice,
        guardrail_clamped_price: agreedPrice,
        is_rule_passed: true,
        public_justification: finalDecision.justification,
      });

      const settlement = await createSettlementOrder({
        sessionId,
        amount: totalAmount,
        skuCode: sku.sku_code,
        productName: sku.name,
        quantity,
        unitPrice: agreedPrice,
      });

      return {
        session_id: sessionId,
        sku_code: sku.sku_code,
        status: "AGREED",
        current_round: nextRound,
        max_rounds: maxRounds,
        final_agreed_price: agreedPrice,
        amount: totalAmount,
        amount_paise: settlement.amount_paise,
        checkout_url: settlement.checkout_url,
        message: finalDecision.justification,
      };
    }

    // HLD Step: Round < 5? -> No -> Negotiation Expired
    if (graphStatus === "EXPIRED" || nextRound > maxRounds) {
      await supabase
        .from("negotiation_sessions")
        .update({
          status: "EXPIRED",
          current_round: nextRound,
          final_offer_price: finalDecision.counter_price,
        })
        .eq("id", sessionId);

      return {
        session_id: sessionId,
        sku_code: sku.sku_code,
        status: "EXPIRED",
        current_round: nextRound,
        max_rounds: maxRounds,
        final_offer_price: finalDecision.counter_price,
        message: "Negotiation expired: maximum 5 negotiation rounds completed without agreement.",
      };
    }

    // HLD Step: Round < 5? -> Yes: Reply to Client (Safe, within limits)
    await supabase
      .from("negotiation_sessions")
      .update({
        status: "IN_PROGRESS",
        current_round: nextRound,
      })
      .eq("id", sessionId);

    await supabase.from("offer_events").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      round_number: nextRound,
      sender: "SELLER_AI",
      quantity: finalDecision.counter_quantity || quantity,
      proposed_price: finalDecision.counter_price,
      guardrail_clamped_price: finalDecision.counter_price,
      is_rule_passed: true,
      public_justification: finalDecision.justification,
    });

    return {
      session_id: sessionId,
      sku_code: sku.sku_code,
      status: "IN_PROGRESS",
      current_round: nextRound,
      max_rounds: maxRounds,
      seller_proposed_price: finalDecision.counter_price,
      counter_quantity: finalDecision.counter_quantity || quantity,
      quantity: quantity,
      draft_justification: finalDecision.justification,
      internal_reasoning: finalDecision.internal_reasoning,
    };
  }

  /**
   * Fetch full session status with SKU, offer events, and payment info
   */
  async getSession(sessionId) {
    const { data: session, error } = await supabase
      .from("negotiation_sessions")
      .select(`
        *,
        catalog_skus (*),
        offer_events (*),
        razorpay_orders (*)
      `)
      .eq("id", sessionId)
      .maybeSingle();

    if (error || !session) {
      throw new Error("Session not found");
    }

    const sortedEvents = (session.offer_events || []).sort((a, b) => a.round_number - b.round_number);
    const latestOffer = sortedEvents[sortedEvents.length - 1];

    return {
      session_id: session.id,
      sku_code: session.catalog_skus?.sku_code,
      product_name: session.catalog_skus?.name,
      base_price: session.catalog_skus?.base_price,
      status: session.status,
      current_round: session.current_round,
      quantity: latestOffer?.quantity || 1,
      final_agreed_price: session.final_agreed_price,
      final_offer_price: session.final_offer_price,
      payment_status: session.razorpay_orders?.[0]?.status || session.razorpay_orders?.status || null,
      checkout_url: `/api/v1/checkout/${session.id}`,
      offer_history: sortedEvents,
    };
  }

  /**
   * Process merchant review decision directly in JavaScript
   */
  async handleMerchantDecision({ sessionId, action, counterPrice, merchantNotes }) {
    const { data: session, error } = await supabase
      .from("negotiation_sessions")
      .select("*, catalog_skus(*), offer_events(*)")
      .eq("id", sessionId)
      .maybeSingle();

    if (error || !session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const sku = session.catalog_skus;
    const qty = session.quantity || 1;
    const normalizedAction = String(action).toLowerCase().trim();

    if (normalizedAction === "approve") {
      const agreedPrice = counterPrice ? Number(counterPrice) : Number(session.pending_approval_price || session.base_price || sku.base_price);
      const totalAmount = agreedPrice * qty;

      await supabase
        .from("negotiation_sessions")
        .update({
          status: "AGREED",
          final_agreed_price: agreedPrice,
        })
        .eq("id", sessionId);

      await supabase
        .from("merchant_approvals")
        .update({
          status: "APPROVED",
          merchant_notes: merchantNotes || "Approved by merchant desk",
          responded_at: new Date().toISOString(),
        })
        .match({ session_id: sessionId, status: "PENDING" });

      await supabase.from("offer_events").insert({
        id: crypto.randomUUID(),
        session_id: sessionId,
        round_number: session.current_round,
        sender: "MERCHANT",
        quantity: qty,
        proposed_price: agreedPrice,
        guardrail_clamped_price: agreedPrice,
        is_rule_passed: true,
        public_justification: merchantNotes || "Merchant approved the requested terms.",
      });

      const settlement = await createSettlementOrder({
        sessionId,
        amount: totalAmount,
        skuCode: sku.sku_code,
        productName: sku.name,
        quantity: qty,
        unitPrice: agreedPrice,
      });

      return {
        session_id: sessionId,
        sku_code: sku.sku_code,
        status: "AGREED",
        final_agreed_price: agreedPrice,
        amount: totalAmount,
        amount_paise: settlement.amount_paise,
        checkout_url: settlement.checkout_url,
        message: "Merchant approved the deal.",
      };
    } else if (normalizedAction === "reject") {
      await supabase
        .from("negotiation_sessions")
        .update({ status: "REJECTED" })
        .eq("id", sessionId);

      await supabase
        .from("merchant_approvals")
        .update({
          status: "REJECTED",
          merchant_notes: merchantNotes || "Rejected by merchant",
          responded_at: new Date().toISOString(),
        })
        .match({ session_id: sessionId, status: "PENDING" });

      return {
        session_id: sessionId,
        status: "REJECTED",
        message: "Merchant rejected the proposal.",
      };
    } else if (normalizedAction === "counter") {
      const parsedCounter = Number(counterPrice);
      await supabase
        .from("negotiation_sessions")
        .update({ status: "IN_PROGRESS" })
        .eq("id", sessionId);

      await supabase
        .from("merchant_approvals")
        .update({
          status: "COUNTERED",
          merchant_notes: merchantNotes,
          responded_at: new Date().toISOString(),
        })
        .match({ session_id: sessionId, status: "PENDING" });

      await supabase.from("offer_events").insert({
        id: crypto.randomUUID(),
        session_id: sessionId,
        round_number: session.current_round,
        sender: "MERCHANT",
        quantity: qty,
        proposed_price: parsedCounter,
        guardrail_clamped_price: parsedCounter,
        is_rule_passed: true,
        public_justification: merchantNotes || `Merchant counter-offered at ₹${parsedCounter}/unit.`,
      });

      return {
        session_id: sessionId,
        sku_code: sku.sku_code,
        status: "IN_PROGRESS",
        seller_proposed_price: parsedCounter,
        message: `Merchant issued a counter-offer of ₹${parsedCounter}.`,
      };
    } else {
      throw new Error(`Unknown action '${action}'`);
    }
  }
}

module.exports = new NegotiationService();
