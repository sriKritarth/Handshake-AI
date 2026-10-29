/**
 * Direct Payment Settlement Service (Without Audit Chain)
 * Feature: Payments & Settlement
 */

const crypto = require("crypto");
const supabase = require("../../config/db");
require("dotenv").config();

/**
 * Creates or retrieves a direct settlement record for an AGREED negotiation session.
 */
async function createSettlementOrder({ sessionId, amount}) {
  const amountPaise = Math.round(amount * 100);
  const testOrderId = `order_${sessionId.replace(/-/g, "").substring(0, 16)}`;
  const directCheckoutUrl = `/api/v1/checkout/${sessionId}`;

  // Check if order already exists in database
  const { data: existingOrder } = await supabase
    .from("razorpay_orders")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (existingOrder) {
    return {
      order_id: existingOrder.razorpay_order_id,
      amount: existingOrder.amount,
      amount_paise: Math.round(Number(existingOrder.amount) * 100),
      currency: "INR",
      checkout_url: directCheckoutUrl,
      status: existingOrder.status,
    };
  }

  // Insert direct settlement order into Supabase
  const { data: newOrder, error } = await supabase
    .from("razorpay_orders")
    .insert({
      session_id: sessionId,
      razorpay_order_id: testOrderId,
      amount: amount,
      status: "CREATED",
      short_url: directCheckoutUrl,
    })
    .select()
    .maybeSingle();

  if (error) {
    console.warn("Could not record razorpay_order in DB, proceeding with generated order:", error.message);
  }

  return {
    order_id: testOrderId,
    amount: amount,
    amount_paise: amountPaise,
    currency: "INR",
    checkout_url: directCheckoutUrl,
    status: "CREATED",
  };
}

/**
 * Verifies Razorpay Webhook signature directly using HMAC-SHA256
 * Updates session and order directly to PAID without older audit chain
 */
async function processDirectWebhook({ signature, rawBody, body }) {
  const secret =  process.env.TEST_KEY_SECRET ;

  if (!secret) {
    throw new Error("Razorpay webhook secret is not configured on the server.");
  }

  if (!signature) {
    throw new Error("Missing webhook signature header ('x-razorpay-signature').");
  }

  const payloadString = typeof rawBody === "string" && rawBody.length > 0 ? rawBody : JSON.stringify(body);
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payloadString)
    .digest("hex");

  const signatureBuffer = Buffer.from(signature, "utf-8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf-8");

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid webhook signature mismatch.");
  }

  const { event, payload } = body || {};
  const paymentCapturedEvents = ["payment.captured", "order.paid"];

  if (event && paymentCapturedEvents.includes(event)) {
    const paymentEntity = payload?.payment?.entity || {};
    const orderEntity = payload?.order?.entity || {};

    const razorpayOrderId = paymentEntity.order_id || orderEntity.id;
    const sessionId = paymentEntity.notes?.session_id || orderEntity.notes?.session_id;

    // 1. Update razorpay_orders table to PAID
    if (razorpayOrderId) {
      await supabase
        .from("razorpay_orders")
        .update({ status: "PAID" })
        .eq("razorpay_order_id", razorpayOrderId);
    } else if (sessionId) {
      await supabase
        .from("razorpay_orders")
        .update({ status: "PAID" })
        .eq("session_id", sessionId);
    }

    // 2. Direct instant settlement on negotiation_sessions table
    if (sessionId) {
      await supabase
        .from("negotiation_sessions")
        .update({ status: "PAID" })
        .eq("id", sessionId);

      // 3. Deduct purchased inventory from catalog_skus
      const sessionQuery = supabase.from("negotiation_sessions");
      if (typeof sessionQuery.select === "function") {
        const { data: sessionData } = (await sessionQuery
          .select("id, sku_id, offer_events(quantity, round_number)")
          .eq("id", sessionId)
          .maybeSingle?.()) || {};

        if (sessionData?.sku_id) {
          // fetch latest offer
          const latestOffer = (sessionData.offer_events || []).sort(
            (a, b) => b.round_number - a.round_number
          )[0];
          const purchasedQty = Math.max(
            1,
            Number(
              paymentEntity.notes?.quantity ||
                orderEntity.notes?.quantity ||
                latestOffer?.quantity ||
                0
            ) || 1
          );

          const skuQuery = supabase.from("catalog_skus");
          if (typeof skuQuery.select === "function") {
            const { data: skuItem } = (await skuQuery
              .select("id, inventory_qty")
              .eq("id", sessionData.sku_id)
              .maybeSingle?.()) || {};

            if (skuItem) {
              const currentStock = Number(
                skuItem.inventory_qty != null ? skuItem.inventory_qty : 0
              );
              const newStock = Math.max(0, currentStock - purchasedQty);
              await supabase
                .from("catalog_skus")
                .update({ inventory_qty: newStock })
                .eq("id", skuItem.id);
            }
          }
        }
      }
    }

    return {
      success: true,
      settled: true,
      message: "Order successfully settled and marked as PAID directly.",
    };
  }

  return {
    success: true,
    settled: false,
    message: "Event received and acknowledged.",
  };
}

module.exports = {
  createSettlementOrder,
  processDirectWebhook,
};
