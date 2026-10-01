const jwt = require("jsonwebtoken");
const supabase = require("../config/db")

/**
 * Middleware to authenticate requests via Bearer JWT token.
 * Extracts token from 'Authorization: Bearer <token>' header.
 */
const authenticateToken = (req, res, next) => {
  try {
    const authHeader = req.header("Authorization") 

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authorization header missing or malformed (expected 'Bearer <token>')",
      });
    }

    const token = authHeader.replace("Bearer " , "")
    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access token is missing",
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SIGN);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token has expired. Please log in again.",
      });
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token signature or malformed token.",
      });
    }

    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

/**
 * Role-Based Access Control (RBAC) middleware factory.
 * Usage: router.get('/merchant/desk', authenticateToken, requireRole('merchant'), controller);
 */
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: [${allowedRoles.join(", ")}]. Your role: ${req.user?.role || "none"}`,
      });
    }
    next();
  };
};

module.exports = { authenticateToken, requireRole };
