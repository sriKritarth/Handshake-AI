/**
 * Local persistent store for captured and verified Razorpay orders.
 * Ensures the buyer's UI immediately and permanently marks settled deals as PAID.
 */

const STORAGE_KEY = "handshake_paid_sessions";

interface PaidRecord {
  payment_id?: string;
  paid_at: string;
}

function getStoredRecords(): Record<string, PaidRecord> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function markSessionPaid(sessionId: string, paymentId?: string): void {
  if (!sessionId) return;
  try {
    const records = getStoredRecords();
    records[sessionId] = {
      payment_id: paymentId || `pay_${Date.now()}`,
      paid_at: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (err) {
    console.error("Failed to persist paid status:", err);
  }
}

export function isSessionPaid(sessionId: string): boolean {
  if (!sessionId) return false;
  const records = getStoredRecords();
  return Boolean(records[sessionId]);
}

export function getPaidSessionInfo(sessionId: string): PaidRecord | null {
  if (!sessionId) return null;
  const records = getStoredRecords();
  return records[sessionId] || null;
}

export function getAllPaidSessionIds(): Set<string> {
  const records = getStoredRecords();
  return new Set(Object.keys(records));
}
