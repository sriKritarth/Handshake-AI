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
        const rzpOrder = session.razorpay_orders?.[0];

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

exports.chekout_webhook = async function (req, res) {
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
            const razorpay_order_id = payload?.payment?.entity?.order_id || payload?.order?.entity?.id || payload?.entity?.order_id;
            
            const {error } = await supabase
                .from("razorpay_orders")
                .update({ status: "PAID" })
                .eq("razorpay_order_id",razorpay_order_id)
                .select();

            
            if (error) {
                console.error("Database update error:", error.message);
                return res.status(500).json({ success: false, message: error.message });
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