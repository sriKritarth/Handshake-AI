const supabase = require("../../config/db.js");
const negotiationService = require("../../features/negotiation/negotiationService");
require("dotenv").config();

/**
 * Initiate a new negotiation session
 * POST /api/v1/sessions
 */
exports.createSession = async function (req, res) {
  try {
    const { sku_code, quantity } = req.body;

    if (!sku_code || typeof sku_code !== "string" || !sku_code.trim()) {
      return res.status(422).json({
        success: false,
        message: "Field 'sku_code' is required and must be a valid string",
      });
    }

    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) {
      return res.status(422).json({
        success: false,
        message: "Field 'quantity' must be a positive integer greater than 0",
      });
    }

    const buyerId = req.user.id;
    const cleanSku = sku_code.trim();

    const result = await negotiationService.createSession({
      buyerId,
      skuCode: cleanSku,
      quantity: qty,
      channel: "CHAT",
    });

    return res.status(201).json({
      success: true,
      session_id: result.session_id,
      data: result,
      message: "Negotiation session initiated successfully",
    });
  } catch (err) {
    console.error("Session creation error:", err);
    return res.status(err.message.includes("not found") ? 404 : 500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};

/**
 * List negotiation sessions with Role-Based Access Control (RBAC)
 * GET /api/v1/sessions
 */
exports.listSessions = async function (req, res) {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;
    const { status } = req.query;

    const parsedPage = parseInt(req.query.page);
    const parsedLimit = parseInt(req.query.limit);
    const page = !isNaN(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit = !isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 15;

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from("negotiation_sessions")
      .select(`
        id,
        status,
        current_round,
        channel,
        final_agreed_price,
        expires_at,
        created_at,
        updated_at,
        catalog_skus (
          sku_code,
          name,
          base_price
        ),
        offer_events (
          round_number,
          sender,
          proposed_price,
          guardrail_clamped_price,
          quantity,
          created_at
        ),
        razorpay_orders (
          amount,
          status
        )
      `, { count: "exact" })
      .order("created_at", { ascending: false });

    if (userRole === "buyer") {
      query = query.eq("buyer_id", userId);
    }

    if (status && status.toLowerCase() !== "all") {
      query = query.eq("status", status.toUpperCase());
    }

    query = query.range(from, to);

    const { data: rawSessions, count: totalCount, error } = await query;

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to retrieve sessions",
      });
    }

    const sessions = (rawSessions || []).map((s) => {
      const events = Array.isArray(s.offer_events)
        ? [...s.offer_events].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        : [];

      const latestBuyerEv = events.find((e) => e.sender?.toUpperCase() === "BUYER");
      const latestSellerEv = events.find((e) => {
        const seller = ["SELLER_AI", "SELLER_GUARDRAIL", "MERCHANT"];
        return seller.includes(e.sender?.toUpperCase());
      });

      const latestAnyEv = events[0];
      const latestOrder = Array.isArray(s.razorpay_orders) ? s.razorpay_orders[0] : s.razorpay_orders;

      return {
        session_id: s.id,
        status: s.status,
        current_round: s.current_round,
        channel: s.channel,
        quantity: latestAnyEv?.quantity || 1,
        sku_code: s.catalog_skus?.sku_code || null,
        product_name: s.catalog_skus?.name || null,
        base_price: s.catalog_skus?.base_price || 0,
        latest_buyer_price: latestBuyerEv?.proposed_price || null,
        latest_seller_price: latestSellerEv?.proposed_price || null,
        final_agreed_price: s.final_agreed_price || null,
        latest_amount: latestOrder?.amount || 0,
        payment_status: latestOrder?.status || null,
        created_at: s.created_at,
        updated_at: s.updated_at,
      };
    });

    const total = typeof totalCount === "number" ? totalCount : sessions.length;
    const totalPages = Math.ceil(total / limit) || (total > 0 ? 1 : 0);
    const hasMore = to < total - 1;

    return res.status(200).json({
      success: true,
      count: sessions.length,
      total,
      page,
      limit,
      total_pages: totalPages,
      has_more: hasMore,
      data: sessions,
      message: "Sessions retrieved successfully",
    });
  } catch (err) {
    console.error("List sessions error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};

/**
 * Get single session by ID
 * GET /api/v1/sessions/:session_id
 */
exports.getSession = async function (req, res) {
  try {
    const { session_id } = req.params;
    const sessionData = await negotiationService.getSession(session_id);

    return res.status(200).json({
      success: true,
      data: sessionData,
      message: "Session retrieved successfully",
    });
  } catch (err) {
    if (err.statusCode === 410 || err.status === "EXPIRED") {
      return res.status(410).json({
        success: false,
        status: "EXPIRED",
        message: err.message || "Negotiation session expired due to inactivity.",
      });
    }
    console.error("Get session error:", err);
    return res.status(err.message?.includes("not found") ? 404 : 500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};

/**
 * Process buyer proposal / counter-move
 * POST /api/v1/sessions/:session_id/moves
 */
exports.buyer_moves = async function (req, res) {
  try {
    const { session_id } = req.params;
    const { offered_price, quantity, buyer_message, accept_last_offer } = req.body;

    const parsedPrice = parseFloat(offered_price);
    if (!accept_last_offer && (isNaN(parsedPrice) || parsedPrice <= 0)) {
      return res.status(422).json({
        success: false,
        message: "Field 'offered_price' must be a valid positive number",
      });
    }

    const qty = Number(quantity || 1);
    if (isNaN(qty) || qty <= 0) {
      return res.status(422).json({
        success: false,
        message: "Field 'quantity' must be a positive integer greater than 0",
      });
    }

    const result = await negotiationService.processBuyerMove({
      sessionId: session_id,
      buyerId: req.user.id,
      offeredPrice: parsedPrice,
      quantity: qty,
      buyerMessage: buyer_message || "",
      acceptLastOffer: Boolean(accept_last_offer),
    });

    result.internal_reasoning = undefined;

    return res.status(200).json({
      success: true,
      data: result,
      message: "Negotiation move processed successfully",
    });
  } catch (err) {
    if (err.statusCode === 410 || err.status === "EXPIRED") {
      return res.status(410).json({
        success: false,
        status: "EXPIRED",
        message: err.message || "Negotiation session expired due to inactivity.",
      });
    }
    console.error("Buyer move error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to process negotiation move",
    });
  }
};

/**
 * Buyer accepts seller's counter offer
 * POST /api/v1/sessions/:session_id/accept
 */
exports.acceptOffer = async function (req, res) {
  try {
    const { session_id } = req.params;
    const result = await negotiationService.processBuyerMove({
      sessionId: session_id,
      buyerId: req.user.id,
      acceptLastOffer: true,
    });

    return res.status(200).json({
      success: true,
      data: result,
      message: "Offer accepted successfully. Proceed to direct checkout.",
    });
  } catch (err) {
    if (err.statusCode === 410 || err.status === "EXPIRED") {
      return res.status(410).json({
        success: false,
        status: "EXPIRED",
        message: err.message || "Negotiation session expired due to inactivity.",
      });
    }
    console.error("Accept offer error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to accept offer",
    });
  }
};

/**
 * Buyer declines offer and walks away
 * POST /api/v1/sessions/:session_id/decline
 */
exports.declineOffer = async function (req, res) {
  try {
    const { session_id } = req.params;

    await supabase
      .from("negotiation_sessions")
      .update({ status: "REJECTED" })
      .eq("id", session_id);

    return res.status(200).json({
      success: true,
      message: "Negotiation concluded. Offer declined.",
    });
  } catch (err) {
    console.error("Decline offer error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to decline offer",
    });
  }
};
