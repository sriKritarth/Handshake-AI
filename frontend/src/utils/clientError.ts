/**
 * Client-Friendly Error Normalizer
 * Enforces production-grade enterprise B2B platform standards:
 * - Completely masks backend stack traces, Python/SQL errors, and database table names.
 * - Replaces low-level JSON parser syntax errors (e.g. Unexpected token 'I'...) with polite business messages.
 * - Converts FSM state machine transition failures into friendly deal guidance.
 */

export function toClientFriendlyMessage(
  err: unknown,
  fallback = "Unable to process request at this moment. Please try again."
): string {
  if (!err) return fallback;

  let raw = "";
  if (typeof err === "string") {
    raw = err;
  } else if (typeof err === "object" && err !== null) {
    const errorObj = err as any;
    raw =
      errorObj?.data?.message ||
      errorObj?.data?.detail ||
      errorObj?.message ||
      "";
  }

  if (!raw || typeof raw !== "string") {
    return fallback;
  }

  const lower = raw.toLowerCase();

  // 1. JSON Parser / Gateway Unhandled 500 Responses
  if (
    lower.includes("not valid json") ||
    lower.includes("unexpected token") ||
    lower.includes("internal server") ||
    lower.includes("syntaxerror") ||
    lower.includes("<!doctype") ||
    lower.includes("<html>")
  ) {
    return "Our negotiation engine is momentarily deliberating. Please try again shortly or propose your offer directly.";
  }

  // 2. Pricing Policy / Configuration
  if (
    lower.includes("pricing policy") ||
    lower.includes("policy for sku") ||
    lower.includes("policy not found")
  ) {
    return "This product's wholesale pricing terms are currently undergoing seller verification. Please select another wholesale catalog item.";
  }

  // 3. Network & Connection
  if (
    lower.includes("unreachable") ||
    lower.includes("econnrefused") ||
    lower.includes("temporarily unreachable") ||
    lower.includes("failed to fetch") ||
    lower.includes("networkerror")
  ) {
    return "Trading engine is momentarily unavailable. Please check your connection and retry.";
  }

  // 4. Session State Machine & Lifecycle
  if (
    lower.includes("terminal state") ||
    lower.includes("already closed") ||
    lower.includes("expired")
  ) {
    return "This negotiation session is already concluded. Check your deal history or initiate a new inquiry.";
  }

  if (
    lower.includes("pending_approval") ||
    lower.includes("pending approval") ||
    lower.includes("merchant desk")
  ) {
    return "This proposal has been forwarded to the Merchant Desk for executive review. Additional proposals are paused until reviewed.";
  }

  if (lower.includes("final_offer") || lower.includes("final offer")) {
    return "This deal has reached its final round. You may accept the seller's final offer or decline to close.";
  }

  if (
    lower.includes("cannot execute event") ||
    lower.includes("invalidstatetransition")
  ) {
    return "This action is not available in the current negotiation stage.";
  }

  // 5. Stock & Inventory Constraints
  if (lower.includes("insufficient stock") || lower.includes("out of stock")) {
    return "The requested quantity exceeds available warehouse inventory. Please request a smaller batch.";
  }

  if (
    lower.includes("below updated floor") ||
    lower.includes("price no longer valid")
  ) {
    return "The proposed price is no longer available under current wholesale catalog terms.";
  }

  // 6. Security & Permissions
  if (
    lower.includes("access denied") ||
    lower.includes("forbidden") ||
    lower.includes("unauthorized")
  ) {
    return "You do not have permission to access or modify this trade session.";
  }

  if (
    lower.includes("jwt") ||
    lower.includes("token expired") ||
    lower.includes("authentication failed")
  ) {
    return "Your login session has expired. Please log in again to continue.";
  }

  // 7. General Backend/Database Leak Prevention
  // If the message contains technical tokens like SQL, table names, UUIDs, tracebacks, etc.
  if (
    lower.includes("supabase") ||
    lower.includes("postgres") ||
    lower.includes("select ") ||
    lower.includes("insert ") ||
    lower.includes("update ") ||
    lower.includes("from ") ||
    lower.includes("table") ||
    lower.includes("uuid") ||
    lower.includes("traceback") ||
    lower.includes("nullpointer") ||
    lower.includes("typeerror") ||
    lower.includes("undefined")
  ) {
    return "The operation could not be completed at this time. Please refresh and try again.";
  }

  return raw;
}
