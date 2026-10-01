const supabase = require("../../config/db.js");
require('dotenv').config();

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;

exports.createSession = async function (req, res) {
  try {
    const { sku_code, quantity } = req.body;

    // 1. Basic Type Validation
    if (!sku_code || typeof sku_code !== "string" || !sku_code.trim()) {
      return res.status(422).json({
        success: false,
        message: "Field 'sku_code' is required and must be a valid string",
      });
    }

    if (isNaN(quantity) || quantity <= 0) {
      return res.status(422).json({
        success: false,
        message: "Field 'quantity' must be a positive integer greater than 0",
      });
    }

    const cleanSku = sku_code.trim();

    // 2. Database SKU Existence Check (Fail-Fast with 404)
    const { data: skuItem, error: skuError } = await supabase
      .from("catalog_skus")
      .select("id, sku_code, name")
      .eq("sku_code", cleanSku)
      .maybeSingle();

    if (skuError) {
      return res.status(500).json({
        success: false,
        message: skuError.message || "Failed to query catalog for SKU validation",
      });
    }

    if (!skuItem) {
      return res.status(404).json({
        success: false,
        message: `SKU '${cleanSku}' does not exist in the catalog`,
      });
    }

    // 3. Identity Binding (prevent buyer ID spoofing)
    const buyer_id = req.user.id
    // 4. Forward to Internal Python Negotiation Service
    const payload = {
      buyer_id: String(buyer_id),
      sku_code: cleanSku,
      quantity: quantity,
      channel: "CHAT",
    };

    let pythonResponse;
    try {
      pythonResponse = await fetch(`${PYTHON_SERVICE_URL}/api/v1/sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": ADMIN_KEY,
        },
        body: JSON.stringify(payload),
      });
    } catch (networkErr) {
      console.error("Python engine connection error:", networkErr.message);
      return res.status(502).json({
        success: false,
        message: "Negotiation engine is temporarily unreachable. Please try again shortly.",
      });
    }

    const responseData = await pythonResponse.json();
    // console.log(responseData);

    if (!pythonResponse.ok) {
      return res.status(pythonResponse.status).json({
        success: false,
        message: responseData.detail || responseData.message || "Failed to initiate negotiation session",
        upstream_error: responseData,
      });
    }

    // 5. Return 201 Created
    return res.status(201).json({
      success: true,
      session_id: responseData.session_id,
      data: responseData,
      message: "Negotiation session initiated successfully",
    });

  } catch (err) {
    console.error("Session creation error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};


/**
 * List negotiation sessions with Role-Based Access Control (RBAC)
 * GET /api/v1/sessions
 * Allowed Roles: buyer (own), merchant, admin
 * Query Params: ?status=all | INITIATED | IN_PROGRESS | PENDING_APPROVAL | FINAL_OFFER | AGREED
 */
exports.listSessions = async function (req, res) {
  try {
    const userRole = req.user.role;
    const userId = req.user.id;
    const { status } = req.query;

    const ACTIVE_STATES = ["INITIATED", "IN_PROGRESS", "PENDING_APPROVAL", "FINAL_OFFER"];

    // 1. Build Base Supabase Query with relational joins
    let query = supabase
      .from("negotiation_sessions")
      .select(`
        id,
        status,
        current_round,
        final_agreed_price,
        channel,
        created_at,
        updated_at,
        expires_at,
        buyer_id,
        catalog_skus (
          sku_code,
          name,
          category,
          base_price
        ),
        offer_events (
          round_number,
          sender,
          proposed_price,
          guardrail_clamped_price,
          created_at
        )
      `)
      .order("created_at", { ascending: false });

    // 2. Role-Based Visibility Guard
    if (userRole === "buyer") {
      // Buyers can ONLY see their own sessions
      query = query.eq("buyer_id", String(userId));
    }
    // Merchants and Admins can see all sessions across the catalog

    // 3. Status Filtering (defaults to active sessions)
    if (status && status.toLowerCase() !== "all") {
      query = query.eq("status", status.toUpperCase());
    }
    else if (!status) {
      query = query.in("status", ACTIVE_STATES);
    }

    const { data: rawSessions, error } = await query;

    if (error || !rawSessions) {
      return res.status(500).json({
        success: false,
        message: error.message,
      });
    }

    // 4. Format & extract latest price signals for clean client consumption
    const formattedSessions = rawSessions.map((session) => {
      const events = session.offer_events ? session.offer_events : [];

      let latest_buyer_price = null;
      let latest_seller_price = null;

      // Extract latest prices from offer events
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        const sender = ev.sender.toUpperCase();
        const price = ev.proposed_price || ev.guardrail_clamped_price;

        if (latest_buyer_price === null && sender === "BUYER") {
          latest_buyer_price = price;
        }
        if (
          latest_seller_price === null &&
          ["SELLER_AI", "SELLER_GUARDRAIL", "MERCHANT"].includes(sender)
        ) {
          latest_seller_price = price;
        }
        if (latest_buyer_price !== null && latest_seller_price !== null) break;
      }

      return {
        session_id: session.id,
        status: session.status,
        current_round: session.current_round,
        channel: session.channel,
        buyer_id: session.buyer_id,
        sku_code: session.catalog_skus?.sku_code || null,
        product_name: session.catalog_skus?.name || null,
        base_price: session.catalog_skus?.base_price || null,
        latest_buyer_price,
        latest_seller_price,
        final_agreed_price: session.final_agreed_price,
        created_at: session.created_at,
        expires_at: session.expires_at,
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedSessions.length,
      data: formattedSessions,
      message: "Active sessions retrieved successfully",
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
 * Get single negotiation session state & chat history
 * GET /api/v1/sessions/:session_id
 * Allowed Roles: buyer (own), merchant, admin
 */
exports.getSession = async function (req, res) {
  try {
    const { session_id } = req.params;
    const userRole = req.user.role;
    const userId = req.user.id;

    // 1. UUID Format Validation (Fail-Fast)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!session_id || !uuidRegex.test(session_id.trim())) {
      return res.status(400).json({
        success: false,
        message: "Invalid session_id format. Must be a valid UUID.",
      });
    }

    const cleanSessionId = session_id.trim();

    // 2. Query Session with joined SKU and offer event history from Supabase
    const { data: session, error } = await supabase
      .from("negotiation_sessions")
      .select(`
        id,
        status,
        current_round,
        channel,
        buyer_id,
        final_agreed_price,
        created_at,
        updated_at,
        expires_at,
        catalog_skus (
          sku_code,
          name,
          category,
          base_price
        ),
        offer_events (
          round_number,
          sender,
          proposed_price,
          guardrail_clamped_price,
          public_justification,
          quantity,
          created_at
        )
      `)
      .eq("id", cleanSessionId)
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to query session",
      });
    }

    // 3. Not Found Check
    if (!session) {
      return res.status(404).json({
        success: false,
        message: `Negotiation session '${cleanSessionId}' not found`,
      });
    }

    // 4. IDOR / Ownership Guard:
    // A buyer can ONLY view their own session
    if (userRole === "buyer" && String(session.buyer_id) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not have permission to view this negotiation session.",
      });
    }

    // 5. Sort & format offer events into chronological chat history
    const rawEvents = session.offer_events || [];
    // Sort ascending by time / round so the chat renders in order
    rawEvents.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

    let latest_buyer_price = null;
    let latest_seller_price = null;
    let negotiated_quantity = 1;

    const offer_history = [];

    for (const ev of rawEvents) {
      // Skip lifecycle audit records (round 0 has price 0)
      if (!ev.round_number || ev.round_number <= 0) continue;

      const sender = (ev.sender || "").toUpperCase();
      const price = ev.proposed_price || ev.guardrail_clamped_price;

      if (ev.quantity && ev.quantity > 0) {
        negotiated_quantity = ev.quantity;
      }

      if (sender === "BUYER" && price > 0) {
        latest_buyer_price = price;
      } else if (["SELLER_AI", "SELLER_GUARDRAIL", "MERCHANT"].includes(sender) && price > 0) {
        latest_seller_price = price;
      }

      offer_history.push({
        sender,
        round_number: ev.round_number,
        proposed_price: price,
        public_justification: ev.public_justification || null,
        quantity: ev.quantity || null,
        created_at: ev.created_at,
      });
    }

    // 6. Calculate total amount if deal is agreed
    let amount = null;
    let amount_paise = null;
    let currency = null;
    let checkout_url = null;

    if (session.status === "AGREED" && session.final_agreed_price) {
      amount = session.final_agreed_price * negotiated_quantity;
      amount_paise = Math.round(amount * 100);
      currency = "INR";
      checkout_url = `/api/v1/checkout/${session.id}`;
    }

    return res.status(200).json({
      success: true,
      data: {
        session_id: session.id,
        status: session.status,
        current_round: session.current_round,
        channel: session.channel,
        quantity: negotiated_quantity,
        sku_code: session.catalog_skus?.sku_code || null,
        product_name: session.catalog_skus?.name || null,
        base_price: session.catalog_skus?.base_price || null,
        latest_buyer_price,
        latest_seller_price,
        final_agreed_price: session.final_agreed_price,
        amount,
        amount_paise,
        currency,
        checkout_url,
        expires_at: session.expires_at,
        created_at: session.created_at,
        offer_history,
      },
      message: "Session retrieved successfully",
    });

  } catch (err) {
    console.error("Get session error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Internal server error",
    });
  }
};


exports.buyer_moves = async function (req, res) {
  try {
    const { offered_price, quantity, buyer_message } = req.body
    const { session_id } = req.params
    let default_quantity = 1;
    // Handle edge case

    const parsedPrice = parseFloat(offered_price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return res.status(422).json({
        success: false,
        message: "Field 'offered_price' must be a valid positive number",
      });
    }

    if (isNaN(quantity) || quantity <= 0) {
      return res.status(422).json({
        success: false,
        message: "Field 'quantity' must be a positive integer greater than 0",
      });
    }

    const payload = {
      offered_price: parsedPrice,
      quantity: Number(quantity),
      buyer_message: buyer_message || "",
      accept_last_offer: Boolean(req.body.accept_last_offer || false),
    };

    let pythonResponse;
    try {
      pythonResponse = await fetch(`${PYTHON_SERVICE_URL}/api/v1/sessions/${session_id}/moves`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": ADMIN_KEY,
        },
        body: JSON.stringify(payload),
      });
    } catch (networkErr) {
      console.error("Python engine connection error:", networkErr.message);
      return res.status(502).json({
        success: false,
        message: "Negotiation engine is temporarily unreachable. Please try again shortly.",
      });
    }

    const responseData = await pythonResponse.json();

    if (!pythonResponse.ok) {
      return res.status(pythonResponse.status).json({
        success: false,
        message: responseData.detail || "Failed to process negotiation move",
      });
    }

    return res.status(200).json({
      success: true,
      data:responseData,
      message: responseData.message || "Negotiation move processed successfully",
    });

  }
  catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    })
  }
}

exports.acceptOffer = async function (req , res){
  try{
    const {session_id} = req.params;
    let pythonResponse;
    try{
      pythonResponse = await fetch(`${PYTHON_SERVICE_URL}/api/v1/sessions/${session_id}/accept` , {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": ADMIN_KEY,
        }
      })

    }
    catch(networkerr){
      console.error("Python engine connection error:", networkerr.message);
      return res.status(502).json({
        success: false,
        message: "Negotiation engine is temporarily unreachable. Please try again shortly.",
      });
    }

    const responseData = await pythonResponse.json();

    if (!pythonResponse.ok) {
      return res.status(pythonResponse.status).json({
        success: false,
        message: responseData.detail || "Failed to accept offer",
      });
    }

    return res.status(200).json({
      success: true,
      data:responseData,
      message: responseData.message || "Offer accepted successfully. Deal closed.",
    });

  }
  catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    })
  }
}

exports.declineOffer = async function (req , res){
  try{
    const {session_id} = req.params;
    let pythonResponse;
    try{
      pythonResponse = await fetch(`${PYTHON_SERVICE_URL}/api/v1/sessions/${session_id}/decline` , {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": ADMIN_KEY,
        },
      });

    }
    catch(networkerr){
      console.error("Python engine connection error:", networkerr.message);
      return res.status(502).json({
        success: false,
        message: "Negotiation engine is temporarily unreachable. Please try again shortly.",
      });
    }

    const responseData = await pythonResponse.json();

    if (!pythonResponse.ok) {
      return res.status(pythonResponse.status).json({
        success: false,
        message: responseData.detail || "Failed to decline offer",
      });
    }

    return res.status(200).json({
      success: true,
      data:responseData,
      message: responseData.message || "Offer declined successfully",
    });

  }
  catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    })
  }
}

