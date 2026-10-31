const crypto = require("crypto");
const supabase = require("../../config/db.js");
const eventsController = require("../../controllers/events");

const DEFAULT_TIMEOUT_MS = Number(process.env.SESSION_EXPIRY_TIMEOUT_MS) || (24 * 60 * 60 * 1000); // 24 hours


function isSessionInactive(session, now = new Date(), timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!session || typeof session !== "object") {
    return false;
  }

  // Only IN_PROGRESS sessions can expire due to buyer inactivity
  if (session.status !== "IN_PROGRESS") {
    return false;
  }

  const timestamp = session.updated_at || session.created_at;
  if (!timestamp) {
    return false;
  }

  const sessionTime = new Date(timestamp).getTime();
  if (isNaN(sessionTime)) {
    return false;
  }

  const currentTime = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (isNaN(currentTime)) {
    return false;
  }

  const inactivity = currentTime - sessionTime;

  // Inactivity must be positive and strictly greater than timeoutMs
  return inactivity > timeoutMs;
}

async function expireSession({
  sessionId,
  currentRound = 1,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  db = supabase,
  eventsModule = eventsController,
}) {
  const expiredAt = new Date().toISOString();
  const hours = Math.round(timeoutMs / (60 * 60 * 1000));
  const durationText = hours > 0
    ? `${hours} ${hours === 1 ? "hour" : "hours"}`
    : `${Math.round(timeoutMs / 60000)} minutes`;
  const justification = `Session expired due to ${durationText} of inactivity.`;

  // 1. Mark session 'EXPIRED' in DB
  await db
    .from("negotiation_sessions")
    .update({
      status: "EXPIRED",
      updated_at: expiredAt,
    })
    .eq("id", sessionId);

  // 2. Insert EXPIRED event in offer_events
  await db.from("offer_events").insert({
    id: crypto.randomUUID(),
    session_id: sessionId,
    round_number: currentRound,
    sender: "SYSTEM",
    quantity: null,
    proposed_price: null,
    guardrail_clamped_price: null,
    is_rule_passed: true,
    public_justification: justification,
    created_at: expiredAt,
  });

  // 3. Emit real-time notification to active SSE listeners
  if (eventsModule && typeof eventsModule.emitSessionEvent === "function") {
    eventsModule.emitSessionEvent({
      session_id: sessionId,
      event: "session:expired",
      data: {
        session_id: sessionId,
        status: "EXPIRED",
        message: justification,
        timestamp: expiredAt,
      },
    });
  }

  return {
    session_id: sessionId,
    status: "EXPIRED",
    message: justification,
    expired_at: expiredAt,
  };
}


async function checkAndExpireSession(session, options = {}) {
  const now = options.now || new Date();
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const db = options.db || supabase;
  const eventsModule = options.eventsModule || eventsController;

  if (isSessionInactive(session, now, timeoutMs)) {
    const expiredRecord = await expireSession({
      sessionId: session.id,
      currentRound: session.current_round || 1,
      timeoutMs,
      db,
      eventsModule,
    });

    return {
      expired: true,
      session: {
        ...session,
        status: "EXPIRED",
        updated_at: expiredRecord.expired_at,
      },
    };
  }

  return {
    expired: false,
    session,
  };
}


async function sweepExpiredSessions({
  inactivityHours = 24,
  inactivityMinutes,
  db = supabase,
  eventsModule = eventsController,
} = {}) {
  const thresholdMinutes = inactivityMinutes !== undefined ? inactivityMinutes : inactivityHours * 60;
  const thresholdMs = thresholdMinutes * 60 * 1000;
  const thresholdDate = new Date(Date.now() - thresholdMs).toISOString();

  const { data: staleSessions, error } = await db
    .from("negotiation_sessions")
    .select("id, current_round")
    .eq("status", "IN_PROGRESS")
    .lt("updated_at", thresholdDate);

  if (error || !Array.isArray(staleSessions)) {
    return {
      swept_count: 0,
      expired_session_ids: [],
    };
  }

  const expiredIds = [];
  for (const s of staleSessions) {
    await expireSession({
      sessionId: s.id,
      currentRound: s.current_round || 1,
      timeoutMs: thresholdMs,
      db,
      eventsModule,
    });
    expiredIds.push(s.id);
  }

  return {
    swept_count: expiredIds.length,
    expired_session_ids: expiredIds,
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  isSessionInactive,
  expireSession,
  checkAndExpireSession,
  sweepExpiredSessions,
};
