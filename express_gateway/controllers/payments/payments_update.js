const supabase = require("../../config/db");
require("dotenv").config();
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL

exports.checkout = async function (req, res) {
    try {
        const { session_id } = req.params;

        // 1. Fetch session, SKU, negotiated quantity, and razorpay order in ONE relational query
        const { data: session, error } = await supabase
            .from("negotiation_sessions")
            .select(`
        id,
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
        const quantity = latestOffer.quantity;

        // 4. Calculate exact outlay
        const unitPrice = Number(session.final_agreed_price);
        const amount = unitPrice * quantity;
        const amountPaise = Math.round(amount * 100);

        // 5. Extract latest Razorpay order
        const rzpOrder = session.razorpay_orders;

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
                payment_url: `${PYTHON_SERVICE_URL}/api/v1/checkout/${session.id}`,
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

exports.checkout_webhook = async function (req, res) {
    try {
        const signature = req.headers['x-razorpay-signature'];
        if (!signature) {
            return res.status(404).json({
                success: false,
                message: "No signature present"
            })
        }

        const crypto = require("crypto");
        const secret = process.env.RAZORPAY_KEY_SECRET;
        const expectedSignature = crypto.createHmac("sha256", secret).update(JSON.stringify(req.body)).digest("hex");

        if (signature !== expectedSignature) {
            return res.status(400).json({ success: false, message: "Invalid signature" });
        }
        const events = ["payment.captured", "order.paid"]
        const { event, payload } = req.body;
        if (events.includes(event)) {

            const paymentEntity = payload.payment.entity;
            const razorpay_order_id = paymentEntity.order_id || payload.order.entity.id;
            const session_id = paymentEntity.notes.session_id || payload.order.entity.notes.session_id;
            // 1. Update razorpay_orders
            if (razorpay_order_id) {               
                const {error} = await supabase.from("razorpay_orders").update({ status: "PAID" }).eq("razorpay_order_id", razorpay_order_id);

                if(error){
                    console.log(error.message);

                    return res.status(500).json({
                        success : false,
                        message : error.message
                    })

                }

            } 
            else if (session_id) {
                const {error} = await supabase.from("razorpay_orders").update({ status: "PAID" }).eq("session_id", session_id);

                if(error){
                    console.log(error.message);

                    return res.status(500).json({
                        success : false,
                        message : error.message
                    })

                }

            }
            

            // console.log(`[Webhook] Order ${razorpay_order_id} marked as PAID.`);
            return res.status(200).json({
                success: true,
                message: "Payment captured and order updated to PAID",
            });

        }

        return res.status(200).json({
            success: true,
            message: `Event ${event} acknowledged`,
        })
    }
    catch (error) {
        console.error(error.message);
        return res.status(500).json({
            success: false,
            message: error.message
        })
    }
};

const crypto = require("crypto");

// In-Memory SKU Cache (5-minute TTL) to eliminate catalog DB queries on every checkout
let skuCache = new Map();
let cacheExpiry = 0;

async function getCachedSkus(skuCodes) {
    const now = Date.now();
    if (now > cacheExpiry || skuCache.size === 0) {
        const { data, error } = await supabase
            .from("catalog_skus")
            .select("id, sku_code, name, base_price");
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

        // 1. Instant SKU Validation (Memory Cache -> 0ms, or 1 DB query if cold)
        const skuCodes = items.map((i) => i.sku_code?.trim()).filter(Boolean);
        const skus = await getCachedSkus(skuCodes);

        if (skus.length !== new Set(skuCodes).size) {
            return res.status(404).json({ success: false, message: "Invalid SKU in cart" });
        }

        const skuMap = new Map(skus.map((s) => [s.sku_code, s]));
        let totalAmount = 0;
        for (const item of items) {
            totalAmount += Number(skuMap.get(item.sku_code).base_price) * Number(item.quantity);
        }

        const amountPaise = Math.round(totalAmount * 100);
        const sessionId = crypto.randomUUID();
        const primarySku = skus[0];

        // 2. PARALLEL EXECUTION: Razorpay API + Supabase Session Insert fire concurrently
        const auth = Buffer.from(
            `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
        ).toString("base64");

        const [rzpOrder, sessionInsert] = await Promise.all([
            fetch("https://api.razorpay.com/v1/orders", {
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
            }).then((r) => r.json()),

            supabase.from("negotiation_sessions").insert({
                id: sessionId,
                sku_id: primarySku.id,
                buyer_id: String(buyer_id),
                channel: "CHAT",
                status: "AGREED",
                current_round: 1,
                final_agreed_price: totalAmount,
            }),
        ]);

        if (rzpOrder.error || sessionInsert.error) {
            console.error("Cart checkout error:", rzpOrder.error || sessionInsert.error);
            return res.status(500).json({ success: false, message: "Failed to initiate checkout" });
        }

        // 3. Final single insert: Link Razorpay order to the session
        await supabase.from("razorpay_orders").insert({
            session_id: sessionId,
            razorpay_order_id: rzpOrder.id,
            razorpay_payment_link_id: `plink_${rzpOrder.id.replace("order_", "")}`,
            short_url: `https://rzp.io/i/${rzpOrder.id}`,
            amount: totalAmount,
            status: "CREATED",
        });

        // 4. Return immediately to the client
        return res.status(200).json({
            success: true,
            session_id: sessionId,
            payment_url: `${process.env.PYTHON_SERVICE_URL}/api/v1/checkout/${sessionId}`,
            amount: totalAmount,
        });
    } catch (error) {
        console.error("Cart checkout error:", error);
        return res.status(500).json({ success: false, message: "Server error during checkout" });
    }
};