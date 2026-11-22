const fs = require("fs");
const supabase = require("../../config/db");
const path = require("path");
require('dotenv').config();
const { processDirectWebhook, createSettlementOrder } = require("../../features/payments/paymentService");
const { escapeHtml } = require("../../utils/sanitize");
const { createOrGetHoldReservation } = require("../../features/payments/inventoryReservationService");


const BACKEND_URL = process.env.BACKEND_URL


exports.checkout = async function (req, res) {
    try {
        const { session_id } = req.params;

        // 1. Fetch session, SKU, negotiated quantity, and razorpay order in ONE relational query
        const { data: session, error } = await supabase
            .from("negotiation_sessions")
            .select(`
        id,
        buyer_id,
        status,
        final_agreed_price,
        catalog_skus (
          sku_code,
          name
        ),
        offer_events (
          quantity,
          round_number
        ),
        razorpay_orders (
          razorpay_order_id,
          short_url,
          amount,
          status
        )
      `)
            .eq("id", session_id)
            .maybeSingle();

        if (error) {
            return res.status(500).json({ success: false, message: error.message });
        }

        if (!session) {
            return res.status(404).json({ success: false, message: "Session not found" });
        }

        // 2. Strict State Guardrail: Only AGREED deals can be checked out
        if (session.status !== "AGREED") {
            return res.status(400).json({
                success: false,
                message: `Session is in status '${session.status}'. Checkout is only accessible for AGREED deals.`,
            });
        }

        // 3. Extract quantity from the latest offer event (or fallback to 1)
        const latestOffer = session.offer_events?.sort((a, b) => b.round_number - a.round_number)[0];
        const quantity = latestOffer?.quantity || 1;
        const skuCode = session.catalog_skus?.sku_code;

        // Step 2: Optimistic Stock Check & HOLD Reservation (10-minute hold)
        // const holdResult = await createOrGetHoldReservation(supabase, {
        //     sessionId: session.id,
        //     skuCode,
        //     buyerId: session.buyer_id || req.user?.id,
        //     qty: quantity,
        //     holdDurationMinutes: 10,
        // });

        // if (!holdResult.success && holdResult.conflict) {
        //     return res.status(409).json({
        //         success: false,
        //         conflict: true,
        //         available_stock: holdResult.availableStock,
        //         message: "Product currently held by other buyers or out of stock",
        //     });
        // }

        // 4. Calculate exact outlay
        const unitPrice = Number(session.final_agreed_price);
        const amount = unitPrice * quantity;
        const amountPaise = Math.round(amount * 100);

        // 5. Extract latest Razorpay order
        const rzpOrder = Array.isArray(session.razorpay_orders) ? session.razorpay_orders[0] : session.razorpay_orders;

        return res.status(200).json({
            success: true,
            data: {
                session_id: session.id,
                sku_code: session.catalog_skus?.sku_code,
                product_name: session.catalog_skus?.name || "B2B Wholesale Order",
                quantity: quantity,
                unit_price: unitPrice,
                amount: amount,
                amount_paise: amountPaise,
                currency: "INR",
                // reservation_id: holdResult.reservation?.id,
                // reservation_expires_at: holdResult.reservation?.expires_at,
                payment_url: `${BACKEND_URL}/api/v1/checkout/${session.id}/page`,
                payment_status: rzpOrder?.status || "CREATED",
                session_status: session.status,
            },
            message: "Checkout parameters retrieved successfully",
        });

    } catch (error) {
        console.error("Checkout controller error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error during checkout",
        });
    }
};

exports.renderCheckoutPage = async function (req, res) {
    try {
        const { session_id } = req.params;

        const { data: session, error } = await supabase
            .from("negotiation_sessions")
            .select(`
                id,
                buyer_id,
                status,
                final_agreed_price,
                catalog_skus (sku_code, name),
                offer_events (quantity, round_number)
            `)
            .eq("id", session_id)
            .maybeSingle();

        if (error || !session) {
            return res.status(404).send("<h2>Session not found</h2>");
        }

        if (session.status !== "AGREED") {
            return res.status(400).send(`<h2>Session is in status '${session.status}'. Only AGREED deals are available for payments.</h2>`);
        }

        const sortedOffers = (session.offer_events || []).sort((a, b) => b.round_number - a.round_number);
        const qty = sortedOffers[0]?.quantity || 1;

        // Step 2: Optimistic Stock Check & HOLD Reservation (10-minute hold)
        // const holdResult = await createOrGetHoldReservation(supabase, {
        //     sessionId: session.id,
        //     skuCode: session.catalog_skus?.sku_code,
        //     buyerId: session.buyer_id || req.user?.id,
        //     qty,
        //     holdDurationMinutes: 10,
        // });

        // if (!holdResult.success && holdResult.conflict) {
        //     return res.status(409).json({
        //         message: "Product is in currrently hold by other buyers"
        //     });
        // }

        // Check stock before opening Razorpay checkout         

        const unitPrice = Number(session.final_agreed_price);
        const amount = unitPrice * qty;
        const amountPaise = Math.round(amount * 100);
        const keyId = process.env.TEST_API_KEY || process.env.RAZORPAY_KEY_ID || "";

        let rzpOrder = null;
        const { data: existingRzpOrder } = await supabase
            .from("razorpay_orders")
            .select("razorpay_order_id")
            .eq("session_id", session.id)
            .maybeSingle();

        rzpOrder = existingRzpOrder;

        // Ensure a valid Razorpay order ID is always generated and linked
        if (!rzpOrder?.razorpay_order_id) {
            const settlement = await createSettlementOrder({
                sessionId: session.id,
                amount,
                buyerId: session.buyer_id || req.user?.id,
                skuCode: session.catalog_skus?.sku_code,
                productName: session.catalog_skus?.name,
                quantity: qty,
                unitPrice,
            });
            rzpOrder = { razorpay_order_id: settlement.order_id };
        }

        const templatePath = path.resolve(__dirname, "../../../templates/checkout.html");
        let html = fs.readFileSync(templatePath, "utf-8");

        const replacements = {
            session_id: escapeHtml(session.id),
            order_id: escapeHtml(rzpOrder.razorpay_order_id || ""),
            sku_code: escapeHtml(session.catalog_skus?.sku_code || ""),
            product_name: escapeHtml(session.catalog_skus?.name || "Wholesale Order"),
            quantity: qty,
            unit_price: unitPrice.toFixed(2),
            amount: amount.toFixed(2),
            amount_paise: amountPaise,
            currency: "INR",
            key_id: escapeHtml(keyId)
            // reservation_id: escapeHtml(holdResult.reservation?.id || ""),
        };

        for (const [k, v] of Object.entries(replacements)) {
            html = html.replace(new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "g"), v);
        }

        res.setHeader("Content-Type", "text/html");
        return res.status(200).send(html);
    } catch (err) {
        console.error("Render checkout error:", err);
        return res.status(500).send("<h2>Internal Server Error</h2>");
    }
};

exports.checkout_webhook = async function (req, res) {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const result = await processDirectWebhook({
            signature,
            rawBody: req.rawBody,
            body: req.body,
        });

        return res.status(200).json(result);
    } catch (err) {
        console.error("Webhook processing error:", err.message);
        const isAuthError =
            err.message.toLowerCase().includes("signature") ||
            err.message.toLowerCase().includes("secret") ||
            err.message.toLowerCase().includes("unauthorized");

        return res.status(isAuthError ? 400 : 500).json({
            success: false,
            message: err.message || "Failed to process payment webhook",
        });
    }
};

const crypto = require("crypto");
const { success } = require("zod");

// In-Memory SKU Cache (5-minute TTL) to eliminate catalog DB queries on every checkout
let skuCache = new Map();
let cacheExpiry = 0;

async function getCachedSkus(skuCodes) {
    const now = Date.now();
    if (now > cacheExpiry || skuCache.size === 0) {
        const { data, error } = await supabase
            .from("catalog_skus")
            .select("id, sku_code, name, base_price, inventory_qty");
        if (!error && data) {
            skuCache = new Map(data.map((s) => [s.sku_code, s]));
            cacheExpiry = now + 5 * 60 * 1000; // 5 min TTL
        }
    }
    return skuCodes.map((code) => skuCache.get(code)).filter(Boolean);
}

exports.cartCheckout = async function (req, res) {
    try {
        const { items } = req.body;
        const buyer_id = req.user.id;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(422).json({ success: false, message: "Cart cannot be empty" });
        }

        // 1. Instant SKU & Stock Validation from Supabase (HLD: Add to Cart -> stock?)
        const skuCodes = items.map((i) => i.sku_code?.trim()).filter(Boolean);
        const skus = await getCachedSkus(skuCodes);

        if (skus.length !== new Set(skuCodes).size) {
            return res.status(404).json({ success: false, message: "Invalid SKU in cart" });
        }

        const skuMap = new Map(skus.map((s) => [s.sku_code, s]));
        let totalAmount = 0;
        for (const item of items) {
            const sku = skuMap.get(item.sku_code);
            const stock = sku.inventory_qty != null ? Number(sku.inventory_qty) : 1000;
            const reqQty = Number(Math.max(1, item.quantity) || 1);

            // HLD: stock? No -> stock N.A message client
            if (stock <= 0 || stock < reqQty) {
                return res.status(200).json({
                    success: false,
                    stock_available: false,
                    message: `Stock N.A: Item '${sku.name}' (${sku.sku_code}) is out of stock or requested quantity exceeds available warehouse stock.`,
                });
            }

            totalAmount += Number(sku.base_price) * reqQty;
        }

        const amountPaise = Math.round(totalAmount * 100);
        const sessionId = crypto.randomUUID();
        const primarySku = skus[0];

        // 2. Create Razorpay order first, then record DB state sequentially with rollback safety
        const key_id = process.env.TEST_API_KEY || process.env.RAZORPAY_KEY_ID;
        const key_secret = process.env.TEST_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;
        let rzpOrderId = `order_${sessionId.replace(/-/g, "").substring(0, 16)}`;

        if (key_id && key_secret) {
            try {
                const auth = Buffer.from(`${key_id}:${key_secret}`).toString("base64");
                const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
                    method: "POST",
                    headers: {
                        Authorization: `Basic ${auth}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        amount: amountPaise,
                        currency: "INR",
                        receipt: `rcpt_${Date.now()}`,
                        notes: { session_id: sessionId, buyer_id: String(buyer_id) },
                    }),
                });
                const rzpData = await rzpRes.json();
                if (rzpData?.id) {
                    rzpOrderId = rzpData.id;
                }
            } catch (fetchErr) {
                console.error("Razorpay order creation fallback:", fetchErr.message);
            }
        }

        const { error: sessionInsertError } = await supabase
            .from("negotiation_sessions")
            .insert({
                id: sessionId,
                sku_id: primarySku.id,
                buyer_id: String(buyer_id),
                channel: "CHAT",
                status: "AGREED",
                current_round: 1,
                final_agreed_price: totalAmount,
                agreed_quantity: items[0].quantity || 1
            });

        if (sessionInsertError) {
            console.error("Cart checkout session insert error:", sessionInsertError.message);
            return res.status(500).json({ success: false, message: "Failed to initiate checkout session" });
        }

        // 3. Link Razorpay order to the session
        const { error: rzpInsertError } = await supabase.from("razorpay_orders").insert({
            session_id: sessionId,
            razorpay_order_id: rzpOrderId,
            razorpay_payment_link_id: `plink_${rzpOrderId.replace("order_", "")}`,
            short_url: `${BACKEND_URL}/api/v1/checkout/${sessionId}/page`,
            amount: totalAmount,
            status: "CREATED",
        });

        if (rzpInsertError) {
            console.warn("Could not record razorpay_order in DB:", rzpInsertError.message);
        }

        // 4. Return immediately to the client
        return res.status(200).json({
            success: true,
            session_id: sessionId,
            payment_url: `${BACKEND_URL}/api/v1/checkout/${sessionId}/page`,
            amount: totalAmount,
        });
    } catch (error) {
        console.error("Cart checkout error:", error);
        return res.status(500).json({ success: false, message: "Server error during checkout" });
    }
};
