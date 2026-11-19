/**
 * Negotiation Session Domain Service (Pure JavaScript / Express)
 * Feature: Autonomous Negotiation
 */

const crypto = require("crypto");
const supabase = require("../../config/db");
const { evaluatePreGuardrail } = require("../guardrails/preGuardrail");
const { sellerAgentApp } = require("./sellerAgentGraph");
const { createSettlementOrder } = require("../payments/paymentService");
const sessionExpiryService = require("./sessionExpiryService");

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

    return { sku, policy };
  }

  /**
   * Start a new negotiation session
   */
  async createSession({ buyerId, skuCode, quantity = 1, channel = "CHAT" }) {
    const { sku, policy } = await this.getSkuandPolicy(skuCode);
    const sessionId = crypto.randomUUID();
    const listPrice = Number(sku.base_price);
    const maxRounds = Number(policy?.max_rounds || 5);

    // 1. Create negotiation_sessions record
    const { data: session, error: sessError } = await supabase
      .from("negotiation_sessions")
      .insert({
        id: sessionId,
        sku_id: sku.id,
        merchant_id: sku.merchant_id || null,
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

    // 2. Insert initial SELLER_GUARDRAIL offer event
    const { error: initialEventError } = await supabase.from("offer_events").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      round_number: 1,
      sender: "SELLER_GUARDRAIL",
      quantity: quantity,
      proposed_price: listPrice,
      guardrail_clamped_price: listPrice,
      is_rule_passed: true,
      rule_reason: "Initial catalog listing price",
      public_justification: `Welcome to Handshake AI wholesale procurement. Our listed wholesale catalog price for ${sku.name} is ₹${listPrice} per unit. Make an offer to begin negotiation.`,
    });

    if (initialEventError) {
      console.error("Failed to record initial SELLER_GUARDRAIL offer event:", initialEventError.message);
    }

    return {
      session_id: sessionId,
      sku_code: sku.sku_code,
      status: "IN_PROGRESS",
      current_round: 1,
      max_rounds: maxRounds,
      seller_proposed_price: listPrice,
      quantity: quantity,
      draft_justification: `Wholesale starting offer: ₹${listPrice} per unit.`,
      created_at: session.created_at,
    };
  }

  
  async acceptOffer({ sessionId, buyerId, buyerMessage = "" }) {
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

    const expiryCheck = await sessionExpiryService.checkAndExpireSession(session);
    if (expiryCheck.expired) {
      const err = new Error("Negotiation session expired due to inactivity.");
      err.statusCode = 410;
      err.status = "EXPIRED";
      err.session_id = sessionId;
      throw err;
    }

    if (["AGREED", "REJECTED", "EXPIRED", "PAID"].includes(session.status)) {
      const err = new Error(`Session is already in terminal state '${session.status}'.`);
      if (session.status === "EXPIRED") {
        err.statusCode = 410;
        err.status = "EXPIRED";
      }
      throw err;
    }

    const sku = session.catalog_skus;
    const { policy } = await this.getSkuandPolicy(sku.sku_code);
    const maxRounds = (policy?.max_rounds || 5);

    // Use joined session.offer_events first to avoid redundant DB round-trip
    let allEvents = Array.isArray(session.offer_events) && session.offer_events.length > 0
      ? session.offer_events
      : [];

    if (allEvents.length === 0) {
      const { data: recentEvents, error: eventsError } = await supabase
        .from("offer_events")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });

      if (eventsError) {
        console.warn("Could not query offer_events directly, falling back to session relation:", eventsError.message);
      } else if (Array.isArray(recentEvents)) {
        allEvents = recentEvents;
      }
    }

    // Sort events by created_at descending (or round_number descending)
    allEvents = [...allEvents].sort((a, b) => {
      const timeDiff = new Date(b.created_at || 0) - new Date(a.created_at || 0);
      if (timeDiff !== 0) return timeDiff;
      return (b.round_number || 0) - (a.round_number || 0);
    });

    const latestSellerEvent = allEvents.find((e) => {
      const s = (e.sender || "").toUpperCase();
      return ["SELLER_AI", "SELLER_GUARDRAIL", "MERCHANT"].includes(s);
    });

    const agreedPrice = latestSellerEvent ? Number(latestSellerEvent.proposed_price) : Number(sku.base_price);
    const agreedQuantity = latestSellerEvent?.quantity
      ? Number(latestSellerEvent.quantity)
      : Number(session.quantity || allEvents[0]?.quantity || 1);
    const totalAmount = agreedPrice * agreedQuantity;
    console.log(agreedPrice);
    console.log(agreedQuantity);
    console.log(totalAmount);

    // Update session to AGREED
    await supabase
      .from("negotiation_sessions")
      .update({
        status: "AGREED",
        final_agreed_price: agreedPrice,
      })
      .eq("id", sessionId);

    // Record buyer acceptance event
    const { error: buyerAcceptError } = await supabase.from("offer_events").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      round_number: session.current_round,
      sender: "BUYER",
      quantity: agreedQuantity,
      proposed_price: agreedPrice,
      guardrail_clamped_price: agreedPrice,
      is_rule_passed: true,
      rule_reason: "Buyer accepted seller counter-offer",
      public_justification: buyerMessage || "Buyer agreed to seller counter-offer.",
    });

    if (buyerAcceptError) {
      console.error("Failed to record BUYER acceptance offer event:", buyerAcceptError.message);
    }

    // Direct payment settlement creation
    const settlement = await createSettlementOrder({
      sessionId,
      amount: totalAmount,
      skuCode: sku.sku_code,
      productName: sku.name,
      quantity: agreedQuantity,
      unitPrice: agreedPrice,
    });

    return {
      session_id: sessionId,
      sku_code: sku.sku_code,
      status: "AGREED",
      current_round: session.current_round,
      max_rounds: maxRounds,
      final_agreed_price: agreedPrice,
      quantity: agreedQuantity,
      amount: totalAmount,
      amount_paise: settlement.amount_paise,
      checkout_url: settlement.checkout_url,
      message: "Deal successfully agreed! Direct settlement order created.",
    };
  }

  /**
   * Process incoming buyer move (Counter or Accept)
   */
  async processBuyerMove({ sessionId, buyerId, offeredPrice, quantity = 1, buyerMessage = "", acceptLastOffer = false }) {
    if (acceptLastOffer) {
      return await this.acceptOffer({ sessionId, buyerId, buyerMessage });
    }

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

    // On-Demand check for inactivity expiration
    const expiryCheck = await sessionExpiryService.checkAndExpireSession(session);
    if (expiryCheck.expired) {
      const err = new Error("Negotiation session expired due to inactivity.");
      err.statusCode = 410;
      err.status = "EXPIRED";
      err.session_id = sessionId;
      throw err;
    }

    if (["AGREED", "REJECTED", "EXPIRED", "PAID"].includes(session.status)) {
      const err = new Error(`Session is already in terminal state '${session.status}'.`);
      if (session.status === "EXPIRED") {
        err.statusCode = 410;
        err.status = "EXPIRED";
      }
      throw err;
    }

    const sku = session.catalog_skus;
    const {policy}  = await this.getSkuandPolicy(sku.sku_code);
    const maxRounds = (policy?.max_rounds || 5);

    // Fetch latest events (use joined session.offer_events first to avoid redundant query)
    let eventsList = Array.isArray(session.offer_events) && session.offer_events.length > 0
      ? session.offer_events
      : null;

    if (!eventsList) {
      const { data: recentEvents } = await supabase
        .from("offer_events")
        .select("*")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false });
      eventsList = recentEvents || [];
    }

    const sortedEvents = [...eventsList].sort((a, b) => {
      const timeDiff = new Date(a.created_at || 0) - new Date(b.created_at || 0);
      if (timeDiff !== 0) return timeDiff;
      return (a.round_number || 0) - (b.round_number || 0);
    });

    const latestSellerEvent = [...sortedEvents].reverse().find((e) => {
      const s = (e.sender || "").toUpperCase();
      return ["SELLER_AI", "SELLER_GUARDRAIL", "MERCHANT"].includes(s);
    });

    const lastSellerPrice = latestSellerEvent ? Number(latestSellerEvent.proposed_price) : Number(sku.base_price);

    // 2. Case: Buyer makes a counter-offer
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
    const { error: buyerMoveError } = await supabase.from("offer_events").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      round_number: nextRound,
      sender: "BUYER",
      quantity: quantity,
      proposed_price: buyerOffer,
      guardrail_clamped_price: buyerOffer,
      is_rule_passed: true,
      rule_reason: preCheck.reason || "Buyer proposal",
      public_justification: preCheck.sanitizedMessage,
    });

    if (buyerMoveError) {
      console.error("Failed to record BUYER move offer event:", buyerMoveError.message);
    }

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
    if (graphStatus === "AGREED" || finalDecision?.should_accept) {
      const floorPrice = Number(policy?.floor_price || 0);

      // Reconcile agreed unit price: seller accepted buyer's bid, price MUST be buyer's proposed price
      let agreedPrice = Number(buyerOffer);
      if (isNaN(agreedPrice) || agreedPrice <= 0) {
        agreedPrice = Number(finalDecision.counter_price || lastSellerPrice);
      }

      // Hard floor safety check
      if (floorPrice > 0 && agreedPrice < floorPrice) {
        agreedPrice = floorPrice;
      }
      finalDecision.counter_price = agreedPrice;

      const totalAmount = agreedPrice * quantity;

      await supabase
        .from("negotiation_sessions")
        .update({
          status: "AGREED",
          final_agreed_price: agreedPrice,
          current_round: nextRound,
        })
        .eq("id", sessionId);

      const { error: sellerAgreedError } = await supabase.from("offer_events").insert({
        id: crypto.randomUUID(),
        session_id: sessionId,
        round_number: nextRound,
        sender: "SELLER_GUARDRAIL",
        quantity: quantity,
        proposed_price: agreedPrice,
        guardrail_clamped_price: agreedPrice,
        is_rule_passed: true,
        rule_reason: "Seller accepted buyer proposal",
        public_justification: finalDecision.justification,
      });

      if (sellerAgreedError) {
        console.error("Failed to record SELLER_GUARDRAIL agreed offer event:", sellerAgreedError.message);
      }

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

    const { error: sellerMoveError } = await supabase.from("offer_events").insert({
      id: crypto.randomUUID(),
      session_id: sessionId,
      round_number: nextRound,
      sender: "SELLER_GUARDRAIL",
      quantity: finalDecision.counter_quantity || quantity,
      proposed_price: finalDecision.counter_price,
      guardrail_clamped_price: finalDecision.counter_price,
      is_rule_passed: true,
      rule_reason:"Seller counter-offer",
      public_justification: finalDecision.justification,
    });

    if (sellerMoveError) {
      console.error("Failed to record SELLER_GUARDRAIL counter offer event:", sellerMoveError.message);
    }

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

    // On-Demand check for inactivity expiration
    const expiryCheck = await sessionExpiryService.checkAndExpireSession(session);
    if (expiryCheck.expired) {
      const err = new Error("Negotiation session expired due to inactivity.");
      err.statusCode = 410;
      err.status = "EXPIRED";
      err.session_id = sessionId;
      throw err;
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

      const { error: merchantEventError } = await supabase.from("offer_events").insert({
        id: crypto.randomUUID(),
        session_id: sessionId,
        round_number: session.current_round,
        sender: "MERCHANT",
        quantity: qty,
        proposed_price: agreedPrice,
        guardrail_clamped_price: agreedPrice,
        is_rule_passed: true,
        rule_reason: merchantNotes || "Merchant approved the requested terms.",
        public_justification: merchantNotes || "Merchant approved the requested terms.",
      });

      if (merchantEventError) {
        console.error("Failed to record MERCHANT approval offer event:", merchantEventError.message);
      }

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

      const { error: merchantCounterError } = await supabase.from("offer_events").insert({
        id: crypto.randomUUID(),
        session_id: sessionId,
        round_number: session.current_round,
        sender: "MERCHANT",
        quantity: qty,
        proposed_price: parsedCounter,
        guardrail_clamped_price: parsedCounter,
        is_rule_passed: true,
        rule_reason: merchantNotes || `Merchant counter-offered at ₹${parsedCounter}/unit.`,
        public_justification: merchantNotes || `Merchant counter-offered at ₹${parsedCounter}/unit.`,
      });

      if (merchantCounterError) {
        console.error("Failed to record MERCHANT counter offer event:", merchantCounterError.message);
      }

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
