const express = require("express");
const router = express.Router();

const { sign_up, login, getme, logout } = require("../controllers/auth");
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
const {getaudit ,replayChain , verifyChain} = require("../controllers/audit-chain/audit")
const {checkout , checkout_webhook , cartCheckout} = require("../controllers/payments/payments_update")
const {imageUpload} = require("../controllers/file-upload/cloudinary_upload")


// Authentication & Profile Routes
router.post("/auth/sign_up", sign_up); 
router.post("/auth/login", login);
router.get("/auth/me", authenticateToken, getme);
router.post("/auth/logout", authenticateToken, logout);

// get catalog
router.get("/catalog", authenticateToken, getAllCatalog);
router.get("/catalog/:sku_code", authenticateToken, getCatalogbysku);

// Negotiation sessions
router.post("/sessions", authenticateToken, requireRole("buyer", "admin"), createSession);
router.get("/sessions", authenticateToken, requireRole("buyer", "merchant", "admin"), listSessions);
router.get("/sessions/:session_id", authenticateToken, requireRole("buyer", "merchant", "admin"), getSession);
router.post("/sessions/:session_id/moves", authenticateToken, requireRole("buyer"), verifySessionAccess, buyer_moves);
router.post("/sessions/:session_id/accept", authenticateToken, requireRole("buyer"), verifySessionAccess, acceptOffer);
router.post("/sessions/:session_id/decline", authenticateToken, requireRole("buyer"), verifySessionAccess, declineOffer);

// Autonomous Agent-to-Agent (A2A) Negotiation
router.post("/sessions/:session_id/a2a/step", authenticateToken, requireRole("buyer"), verifySessionAccess, a2aStep);
router.post("/sessions/:session_id/a2a/auto-run", authenticateToken, requireRole("buyer"), verifySessionAccess, a2aAutoRun);

//merchant session
router.get("/merchant/session/get" , authenticateToken , requireRole("merchant") , getPendingsesssions);
router.post("/sessions/:session_id/merchant_decision" , authenticateToken , requireRole("merchant") , counterApprove)


/// audit chain
router.get("/sessions/:session_id/audit" , authenticateToken , requireRole("buyer", "merchant", "admin") ,verifySessionAccess ,  getaudit);
router.get("/sessions/:session_id/replay" , authenticateToken , requireRole("buyer", "merchant", "admin") , verifySessionAccess , replayChain)
router.get("/sessions/:session_id/verify" , authenticateToken , requireRole("buyer", "merchant", "admin") , verifySessionAccess ,  verifyChain);

// payments
router.get("/checkout/:session_id" , authenticateToken , requireRole("buyer") , verifySessionAccess , checkout)
router.post("/checkout/cart", authenticateToken, requireRole("buyer"), cartCheckout);
router.post("/checkout/webhook"  ,  checkout_webhook)

// image upload
router.post("/image_upload/:sku_code" , imageUpload);
module.exports = router;