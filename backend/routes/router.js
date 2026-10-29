const express = require("express");
const router = express.Router();

const { sign_up, login, getme, logout, forgot_password, reset_password } = require("../controllers/auth");
const { authenticateToken , requireRole} = require("../middleware/auth");
const {getAllCatalog , getCatalogbysku} = require("../controllers/catalogs/catalog")
const {
  createSession,
  listSessions,
  getSession,
  buyer_moves,
  acceptOffer,
  declineOffer
} = require("../controllers/negotiation/negotiation");
const {a2aStep,a2aAutoRun} = require("../controllers/negotiation/a2a_negotiation")
const {getPendingsesssions , counterApprove} = require("../controllers/merchant-negotiation/negotiation");
const { verifySessionAccess } = require("../middleware/b2b_middleware");
const {checkout , checkout_webhook , cartCheckout, renderCheckoutPage} = require("../controllers/payments/payments")
const {imageUpload} = require("../controllers/file-upload/cloudinary_upload")
const {auth_limiter , api_limiter , auto_negotiate} = require("../utils/rate-limiter");



// Authentication & Profile Routes
router.post("/auth/sign_up", auth_limiter , sign_up); 
router.post("/auth/login", auth_limiter ,  login);
router.get("/auth/me", authenticateToken, getme);
router.post("/auth/logout", authenticateToken, logout);
router.post("/auth/forgot-password", auth_limiter , forgot_password);
router.post("/auth/reset-password", auth_limiter , reset_password);

// get catalog
router.get("/catalog" ,  getAllCatalog);
router.get("/catalog/:sku_code", getCatalogbysku);

// Negotiation sessions
router.post("/sessions", api_limiter , authenticateToken, requireRole("buyer", "admin"), createSession);
router.get("/sessions", authenticateToken, requireRole("buyer", "merchant", "admin"), listSessions);
router.get("/sessions/:session_id", authenticateToken, requireRole("buyer", "merchant", "admin"), verifySessionAccess, getSession);
router.post("/sessions/:session_id/moves", api_limiter , authenticateToken, requireRole("buyer"), verifySessionAccess, buyer_moves);
router.post("/sessions/:session_id/accept", api_limiter , authenticateToken, requireRole("buyer"), verifySessionAccess, acceptOffer);
router.post("/sessions/:session_id/decline",api_limiter ,  authenticateToken, requireRole("buyer"), verifySessionAccess, declineOffer);

// Autonomous Agent-to-Agent (A2A) Negotiation
router.post("/sessions/:session_id/a2a/step", api_limiter , authenticateToken, requireRole("buyer"), verifySessionAccess, a2aStep);
router.post("/sessions/:session_id/a2a/auto-run", auto_negotiate , authenticateToken, requireRole("buyer"), verifySessionAccess, a2aAutoRun);

//merchant session
router.get("/merchant/session/get" , authenticateToken , requireRole("merchant") , getPendingsesssions);
router.post("/sessions/:session_id/merchant_decision" , authenticateToken , requireRole("merchant") ,verifySessionAccess , counterApprove)


// payments
router.get("/checkout/:session_id" , authenticateToken , requireRole("buyer") , verifySessionAccess , checkout);
router.get("/checkout/:session_id/page", renderCheckoutPage);
router.post("/checkout/cart", authenticateToken, requireRole("buyer"), cartCheckout);
router.post("/checkout/webhook"  ,  checkout_webhook);

// image upload
router.post("/image_upload/:sku_code" , imageUpload);
module.exports = router;