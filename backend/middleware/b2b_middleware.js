const supabase = require("../config/db");

const verifySessionAccess = async (req, res, next) => {
  try {
    const { session_id } = req.params;
    const userRole = req.user.role;
    const userId = req.user.id;

    // 1. UUID Validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!session_id || !uuidRegex.test(session_id.trim())) {
      return res.status(400).json({
        success: false,
        message: "Invalid session_id format. Must be a valid UUID.",
      });
    }

    // 2. Fetch session basic ownership record
    const { data: session, error } = await supabase
      .from("negotiation_sessions")
      .select("id, buyer_id, status, sku_id")
      .eq("id", session_id.trim())
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to verify session access",
      });
    }

    if (!session) {
      return res.status(404).json({
        success: false,
        message: "Negotiation session not found",
      });
    }

    // 3. IDOR Ownership Check (Buyers can only access their own)
    if (userRole === "buyer" && String(session.buyer_id) !== String(userId)) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You do not own this negotiation session.",
      });
    }

    // 4. Attach verified session to request object for controllers to use
    req.negotiationSession = session;
    next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Internal server error during session verification",
    });
  }
};

module.exports = { verifySessionAccess };