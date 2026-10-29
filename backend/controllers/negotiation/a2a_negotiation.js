/**
 * Autonomous Agent-to-Agent (A2A) Negotiation Controller (Pure JavaScript / Express)
 * Feature: Autonomous Negotiation
 */

const supabase = require("../../config/db.js");
const negotiationService = require("../../features/negotiation/negotiationService");
const BuyerAgent = require("../../features/negotiation/buyerAgent");
require("dotenv").config();

/**
 * Execute a single autonomous A2A negotiation step
 * POST /api/v1/sessions/:session_id/a2a/step
 */
exports.a2aStep = async function (req, res) {
  try {
    const { session_id } = req.params;
    const { target_price, walk_away_price, max_budget } = req.body || {};

    const sessionData = await negotiationService.getSession(session_id);

    if (["AGREED", "REJECTED", "EXPIRED", "PAID"].includes(sessionData.status)) {
      return res.status(400).json({
        success: false,
        message: `Session is already in terminal state '${sessionData.status}'`,
      });
    }

    if (sessionData.status === "PENDING_APPROVAL") {
      return res.status(400).json({
        success: false,
        message: "Session is pending merchant approval.",
      });
    }

    const mrp = Number(sessionData.base_price);
    const qty = Number(sessionData.quantity);

    const buyerConfig = {
      product_name: sessionData.product_name,
      sku_code: sessionData.sku_code,
      quantity: qty,
      list_price: mrp,
      target_price: target_price ? Number(target_price) : Math.round(mrp * 0.75),
      walk_away_price: walk_away_price ? Number(walk_away_price) : Math.round(mrp * 0.88),
      max_budget: max_budget ? Number(max_budget) : Math.round(qty * (walk_away_price || mrp * 0.88)),
      max_rounds: 5,
    };

    const buyer = new BuyerAgent(buyerConfig);
    buyer.currentRound = sessionData.current_round;

    // Replay prior history into buyer agent
    const events = sessionData.offer_history || [];
    for (const ev of events) {
      if (ev.sender === "BUYER") {
        buyer.history.push({
          round: ev.round_number,
          buyerOffer: ev.proposed_price,
          buyerMessage: ev.public_justification,
        });
      }
    }

    const lastSellerPrice = sessionData.latest_seller_price || mrp;
    const decision = buyer.decide(lastSellerPrice, "Wholesale terms", qty);

    let moveResult;
    if (decision.action === "ACCEPT") {
      moveResult = await negotiationService.processBuyerMove({
        sessionId: session_id,
        buyerId: req.user.id,
        acceptLastOffer: true,
        quantity: decision.quantity,
        buyerMessage: decision.message,
      });
    } else if (decision.action === "WALK_AWAY") {
      await supabase
        .from("negotiation_sessions")
        .update({ status: "REJECTED" })
        .eq("id", session_id);

      moveResult = {
        session_id,
        status: "REJECTED",
        message: decision.message,
      };
    } else {
      moveResult = await negotiationService.processBuyerMove({
        sessionId: session_id,
        buyerId: req.user.id,
        offeredPrice: decision.offer_price,
        quantity: decision.quantity,
        buyerMessage: decision.message,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        session_id,
        buyer_decision: decision,
        seller_response: moveResult,
        status: moveResult.status,
      },
      message: "A2A step executed successfully",
    });
  } catch (err) {
    console.error("A2A step error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to execute A2A step",
    });
  }
};

/**
 * Execute autonomous A2A auto-run loop until agreement or terminal state
 * POST /api/v1/sessions/:session_id/a2a/auto-run
 */
exports.a2aAutoRun = async function (req, res) {
  try {
    const { session_id } = req.params;
    const transcript = [];
    let finalStatus = "IN_PROGRESS";
    let finalResult = null;

    for (let round = 0; round < 6; round++) {
      const sessionData = await negotiationService.getSession(session_id);
      if (["AGREED", "REJECTED", "EXPIRED", "PENDING_APPROVAL", "PAID"].includes(sessionData.status)) {
        finalStatus = sessionData.status;
        break;
      }

      const mrp = Number(sessionData.base_price || 1000);
      const qty = Number(sessionData.quantity || 1);

      const buyerConfig = {
        product_name: sessionData.product_name,
        sku_code: sessionData.sku_code,
        quantity: qty,
        list_price: mrp,
        target_price: req.body?.target_price ? Number(req.body.target_price) : Math.round(mrp * 0.75),
        walk_away_price: req.body?.walk_away_price ? Number(req.body.walk_away_price) : Math.round(mrp * 0.88),
        max_budget: req.body?.max_budget ? Number(req.body.max_budget) : Math.round(qty * mrp * 0.88),
        max_rounds: 5,
      };

      const buyer = new BuyerAgent(buyerConfig);
      buyer.currentRound = sessionData.current_round;
      let events = sessionData.offer_history || [];
      let buyerOffer = undefined;
      let buyerMessage = undefined;
      let seller_counter = undefined;
      let seller_justification = undefined;
      let buyer_quantity = undefined;
      let seller_quantity = undefined;

      for(const ev of events){
        if(ev.sender === "BUYER"){
          buyerOffer = ev.proposed_price;
          buyerMessage = ev.public_justification;
          buyer_quantity = ev.quantity;
          buyer.recordRound({buyerOffer , buyerMessage , seller_counter , seller_justification , buyer_quantity , seller_quantity})
        }

        else{
          seller_counter = ev.proposed_price;
          seller_justification = ev.public_justification;
          seller_quantity = ev.quantity;
          buyer.recordRound({buyerOffer , buyerMessage , seller_counter , seller_justification , buyer_quantity , seller_quantity});
        }
      }
      

      const lastSellerPrice = seller_counter || mrp;
      
      const decision = buyer.decide(lastSellerPrice, "Standard terms", qty);

      let stepResult;
      if (decision.action === "ACCEPT") {
        stepResult = await negotiationService.processBuyerMove({
          sessionId: session_id,
          buyerId: req.user.id,
          acceptLastOffer: true,
          quantity: decision.quantity,
          buyerMessage: decision.message,
        });
      } else if (decision.action === "WALK_AWAY") {
        await supabase
          .from("negotiation_sessions")
          .update({ status: "REJECTED" })
          .eq("id", session_id);

        stepResult = { status: "REJECTED", message: decision.message };
      } else {
        stepResult = await negotiationService.processBuyerMove({
          sessionId: session_id,
          buyerId: req.user.id,
          offeredPrice: decision.offer_price,
          quantity: decision.quantity,
          buyerMessage: decision.message,
        });
      }

      transcript.push({
        round: sessionData.current_round,
        buyer_decision: decision,
        seller_response: stepResult,
      });

      finalStatus = stepResult.status;
      finalResult = stepResult;

      if (["AGREED", "PENDING_APPROVAL", "REJECTED", "PAID"].includes(stepResult.status)) {
        break;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        session_id,
        final_status: finalStatus,
        total_rounds: transcript.length,
        transcript,
        result: finalResult,
      },
      message: "A2A auto-run completed",
    });
  } catch (err) {
    console.error("A2A auto-run error:", err);
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to execute A2A auto-run",
    });
  }
};
