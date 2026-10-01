const supabase = require("../../config/db.js");
require('dotenv').config();


const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL;
const ADMIN_KEY = process.env.ADMIN_KEY;

/**
 * Run Single A2A Round
 * Body (optional): { target_price, walk_away_price, max_budget }
 * Invokes the Python Autonomous Buyer Agent, executes dual-metric outlay math,
 * and returns buyer move and seller counter in 1 step.
 */
exports.a2aStep = async function (req, res) {
  try {
    const { session_id } = req.params;
    const { target_price, walk_away_price, max_budget } = req.body || {};

    const payload = {};
    if (target_price !== undefined && target_price !== null) {
      const p = parseFloat(target_price);
      if (!isNaN(p) && p > 0) payload.target_price = p;
    }
    if (walk_away_price !== undefined && walk_away_price !== null) {
      const p = parseFloat(walk_away_price);
      if (!isNaN(p) && p > 0) payload.walk_away_price = p;
    }
    if (max_budget !== undefined && max_budget !== null) {
      const b = parseFloat(max_budget);
      if (!isNaN(b) && b > 0) payload.max_budget = b;
    }

    let pythonResponse;
    try {
      pythonResponse = await fetch(`${PYTHON_SERVICE_URL}/api/v1/sessions/${session_id}/a2a/step`, {
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
        message: responseData.detail || "Failed to execute A2A step",
      });
    }

    return res.status(200).json({
      success: true,
      data: responseData,
      message: "A2A single round executed successfully",
    });
  } catch (error) {
    console.error("A2A step error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error during A2A step",
    });
  }
};

/**
 * Run Autonomous Loop to Completion
 * Body (optional): { target_price, walk_away_price, max_budget, max_rounds: 5 }
 * Runs multi-round autonomous loop until deal agreement (AGREED) or escalation (PENDING_APPROVAL).
 * Returns full transcript and outcome.
 */
exports.a2aAutoRun = async function (req, res) {
  try {
    const { session_id } = req.params;
    const { target_price, walk_away_price, max_budget, max_rounds } = req.body || {};

    const payload = {
      max_rounds: max_rounds ? parseInt(max_rounds, 10) : 5,
    };
    if (target_price !== undefined && target_price !== null) {
      const p = parseFloat(target_price);
      if (!isNaN(p) && p > 0) payload.target_price = p;
    }
    if (walk_away_price !== undefined && walk_away_price !== null) {
      const p = parseFloat(walk_away_price);
      if (!isNaN(p) && p > 0) payload.walk_away_price = p;
    }
    if (max_budget !== undefined && max_budget !== null) {
      const b = parseFloat(max_budget);
      if (!isNaN(b) && b > 0) payload.max_budget = b;
    }

    // Extended timeout controller for multi-round LLM deliberation (up to 90 seconds)
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 90000);

    let pythonResponse;
    try {
      pythonResponse = await fetch(`${PYTHON_SERVICE_URL}/api/v1/sessions/${session_id}/a2a/auto-run`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": ADMIN_KEY,
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });
    } catch (networkErr) {
      clearTimeout(timeoutId);
      if (networkErr.name === "AbortError") {
        return res.status(504).json({
          success: false,
          message: "A2A auto-run timed out after 90 seconds",
        });
      }
      console.error("Python engine connection error:", networkErr.message);
      return res.status(502).json({
        success: false,
        message: "Negotiation engine is temporarily unreachable. Please try again shortly.",
      });
    }
    clearTimeout(timeoutId);

    const responseData = await pythonResponse.json();

    if (!pythonResponse.ok) {
      return res.status(pythonResponse.status).json({
        success: false,
        message: responseData.detail || "Failed to execute A2A auto-run",
      });
    }

    return res.status(200).json({
      success: true,
      data: responseData,
      message: `A2A autonomous loop completed with status: ${responseData.final_status}`,
    });
  } catch (error) {
    console.error("A2A auto-run error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error during A2A auto-run",
    });
  }
};



