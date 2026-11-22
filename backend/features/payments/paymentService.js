const crypto = require("crypto");
const supabase = require("../../config/db");
const { captureReservation } = require("./inventoryReservationService");
require("dotenv").config();

/**
 * Creates or retrieves a direct settlement record for an AGREED negotiation session.
 */
async function createSettlementOrder({ sessionId, amount, buyerId, skuCode, productName, quantity, unitPrice }) {
  const amountPaise = Math.round(amount * 100);
  const directCheckoutUrl = `${process.env.BACKEND_URL}/api/v1/checkout/${sessionId}/page`;

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
      checkout_url: existingOrder.short_url,
      status: existingOrder.status,
    };
  }

  const key_id = process.env.TEST_API_KEY;
  const key_secret = process.env.TEST_KEY_SECRET;
  let realOrderId = null;


  if (key_id && key_secret) {
    try {
      const auth = Buffer.from(`${key_id}:${key_secret}`).toString("base64");
      const rzpres = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          receipt: `rcpt_${Date.now()}`,
          notes: {
            session_id: sessionId,
            buyer_id: buyerId ? String(buyerId) : "",
            sku_code: skuCode || "",
            quantity: quantity ? String(quantity) : "1",
          },
        }),
      });

      const rzpdata = await rzpres.json();
      if (rzpdata && rzpdata.id) {
        realOrderId = rzpdata.id;
      }

    } catch (error) {
      console.error("Razorpay order creation fallback:", error.message);
    }
  }

  console.log("Settlement Razorpay order ID:", realOrderId);


  const { data: newOrder, error } = await supabase
    .from("razorpay_orders")
    .insert({
      session_id: sessionId,
      razorpay_order_id: realOrderId,
      razorpay_payment_link_id: "plink_" + realOrderId,
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
    order_id: realOrderId,
    amount: amount,
    amount_paise: amountPaise,
    currency: "INR",
    checkout_url: directCheckoutUrl,
    status: "CREATED",
  };
}


async function verify_payment(req, res) {
  try {
    const session_id = req.params.session_id;
    const { razorpay_payment_id, razorpay_signature } = req.body
    const secret = process.env.TEST_KEY_SECRET;

    if (!session_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(401).json({
        success: false,
        message: "Payment failed , Please try again"
      })
    }

    const { data: existingOrder } = await supabase
      .from("razorpay_orders")
      .select("*")
      .eq("session_id", session_id)
      .maybeSingle();

    const order_id = existingOrder.razorpay_order_id;
    let payloadString = order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payloadString)
      .digest("hex");


    if (expectedSignature === razorpay_signature && existingOrder.status !== "PAID") {
      await supabase.from('razorpay_orders').update({ "status": "PAID" }).eq("razorpay_order_id", order_id);


      const { data: session, error: negotiationError } = await supabase.from('negotiation_sessions').select("*").eq("id", session_id).eq("status", "AGREED").maybeSingle();
      if (negotiationError) {
        console.log(negotiationError.message);
      }

      if (session.status === "AGREED") {
        await supabase
          .from("negotiation_sessions")
          .update({ status: "PAID" })
          .eq("id", session_id);
      }

      let qty = session.agreed_quantity;
      let sku_id = session.sku_id;

      const { data: stock, error: stockError } = await supabase.from('catalog_skus').select("inventory_qty").eq("id", sku_id).maybeSingle();
      if (stockError) {
        console.log(stockError.message);
      }

      let updatedqty = stock.inventory_qty - qty;

      const { data: updatedunit, error: updateError } = await supabase.from('catalog_skus').update({ "inventory_qty": updatedqty }).eq("id", sku_id).select("*");
      if (updateError) {
        console.log(updateError.message);
      }

      return res.status(200).json({
        success: true,
        message: "Payment Successfull"
      })
    }

    else if (existingOrder.status === "PAID") {
      return res.status(200).json({
        success: true,
        message: "Payment already done"
      })
    }

    else {
      return res.status(409).json({
        success: false,
        message: "Payment unsuccessfull"
      })
    }


  }

  catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message
    })

  }
}

/**
 * Verifies Razorpay Webhook signature directly using HMAC-SHA256
 * Updates session and order directly to PAID without older audit chain
 */
async function processDirectWebhook({ signature, rawBody, body }) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

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
  if (event !== "payment.captured" && event !== "order.paid") {
    return { success: true, message: "Event ignored" };
  }
  // 3. Extract IDs
  const payment = payload?.payment?.entity || {};
  const order = payload?.order?.entity || {};
  const orderId = payment.order_id || order.id;
  const sessionId = payment.notes?.session_id || order.notes?.session_id;
  // 4. Idempotency Check (Duplicate delivery guard)
  const { data: existingOrder } = await supabase
    .from("razorpay_orders")
    .select("status, session_id")
    .eq(orderId ? "razorpay_order_id" : "session_id", orderId || sessionId)
    .maybeSingle();
  if (existingOrder?.status === "PAID") {
    return { success: true, message: "Order already settled as PAID" };
  }
  const targetSessionId = sessionId || existingOrder?.session_id;
  // 5. Update Orders Table
  if (orderId) {
    await supabase
      .from("razorpay_orders")
      .update({ status: "PAID" })
      .eq("razorpay_order_id", orderId);
  }
  // 6. Settle Session & Deduct Stock
  if (targetSessionId) {
    const { data: session } = await supabase
      .from("negotiation_sessions")
      .select("id, sku_id, agreed_quantity, status")
      .eq("id", targetSessionId)
      .maybeSingle();
    if (session && session.status !== "PAID") {
      await supabase
        .from("negotiation_sessions")
        .update({ status: "PAID" })
        .eq("id", targetSessionId);
      const qty = session.agreed_quantity || 1;
      const { data: sku } = await supabase
        .from("catalog_skus")
        .select("inventory_qty")
        .eq("id", session.sku_id)
        .maybeSingle();
      if (sku) {
        const updatedStock = Math.max(0, (sku.inventory_qty || 0) - qty);
        await supabase
          .from("catalog_skus")
          .update({ inventory_qty: updatedStock })
          .eq("id", session.sku_id);
      }
    }
  }
  return { success: true, message: "Payment processed and settled successfully" };
}

module.exports = {
  createSettlementOrder,
  processDirectWebhook,
  verify_payment
};
