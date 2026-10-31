const EventEmitter = require("events");
const { sendWelcomeEmail, sendPasswordResetEmail } = require("../config/mailer");
const { formatSseMessage } = require("../utils/sse");

const useEvents = new EventEmitter();

// Hook listener: runs asynchronously whenever 'user:signed_up' is fired
useEvents.on("user:signed_up", async (userData) => {
  try {
    const info = await sendWelcomeEmail(userData.email, userData.firstName, userData.role);
    console.log(`✉️ Post-signup email sent to ${userData.email} (Message ID: ${info?.messageId})`);
  } catch (error) {
    // Log error without crashing or rolling back the user account
    console.error(`❌ Failed to send welcome email to ${userData.email}:`, error.message);
  }
});

// Hook listener: runs asynchronously whenever 'user:forgot_password' is fired
useEvents.on("user:forgot_password", async (resetData) => {
  try {
    const info = await sendPasswordResetEmail(resetData.email, resetData.resetLink, resetData.firstName);
    console.log(`✉️ Password reset email sent to ${resetData.email} (Message ID: ${info?.messageId})`);
  } catch (error) {
    console.error(`❌ Failed to send password reset email to ${resetData.email}:`, error.message);
  }
});

/**
 * Server-Sent Events (SSE) Stream Controller for Negotiation Sessions
 * Steps 2-5: Sets up persistent stream, event subscription, keep-alive, and zero-leak cleanup.
 */
function streamSession(req, res, options = {}) {
  const { session_id } = req.params;

  // Safe writer to prevent ERR_STREAM_WRITE_AFTER_END crashes if client socket closes
  const safeWrite = (chunk) => {
    if (!res.writableEnded && res.writable !== false && typeof res.write === "function") {
      res.write(chunk);
    }
  };

  // Step 2: Set standard SSE HTTP Headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  // Send client reconnection interval
  safeWrite("retry: 5000\n\n");

  // Send initial connected confirmation event
  safeWrite(
    formatSseMessage({
      event: "connected",
      data: {
        session_id,
        message: "Connected to negotiation session live event stream.",
        timestamp: new Date().toISOString(),
      },
    })
  );

  // Step 3: Event Subscription (Central Event Bus)
  const onSessionEvent = (eventPayload) => {
    if (!eventPayload) return;
    const targetSessionId = eventPayload.session_id || eventPayload.sessionId;
    if (String(targetSessionId) === String(session_id)) {
      const eventName = eventPayload.event || "session:update";
      const eventData = eventPayload.data !== undefined ? eventPayload.data : eventPayload;
      const eventId = eventPayload.id;

      safeWrite(
        formatSseMessage({
          event: eventName,
          data: eventData,
          id: eventId,
        })
      );
    }
  };

  useEvents.on("session:event", onSessionEvent);

  // Step 4: Heartbeat & Proxy Keep-Alive (prevent Cloudflare/LB timeout)
  const heartbeatMs = options.heartbeatMs || 20000;
  const heartbeatTimer = setInterval(() => {
    safeWrite(": keep-alive\n\n");
  }, heartbeatMs);

  // Step 5: Connection Cleanup (Zero Memory Leak)
  let isCleanedUp = false;
  const cleanup = () => {
    if (isCleanedUp) return;
    isCleanedUp = true;

    clearInterval(heartbeatTimer);
    useEvents.removeListener("session:event", onSessionEvent);

    if (!res.writableEnded && typeof res.end === "function") {
      res.end();
    }
  };

  if (typeof req.on === "function") {
    req.on("close", cleanup);
  }
}

/**
 * Helper to emit a session event onto the central event bus
 */
function emitSessionEvent({ session_id, event = "session:update", data, id }) {
  useEvents.emit("session:event", { session_id, event, data, id });
}

module.exports = {
  useEvents,
  streamSession,
  emitSessionEvent,
};
