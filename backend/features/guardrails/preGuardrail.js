/**
 * Pre-Guardrail Module
 * Feature: Security, PII, and Off-Topic Filtering
 * As per Handshake AI HLD: Pre-Guardrail (Injection, PII, off-topic)
 */

// Common prompt injection attack patterns
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /system\s+(prompt|override|instruction)/i,
  /reveal\s+(your|the)\s+(instructions|prompt|secret|api\s*key|floor\s*price|margin)/i,
  /you\s+are\s+now\s+(an|in)\s+developer\s+mode/i,
  /(bypass|ignore)\s+(all\s+)?(guardrail|safety|rule|security)/i,
  /developer\s+mode/i,
  /jailbreak/i,
  /as\s+an\s+ai\s+language\s+model,\s+you\s+must/i,
  /print\s+(all\s+)?(internal|hidden)\s+variables/i,
];

// PII patterns (Phone numbers, emails, credit card formats)
const PII_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, // Email
  /\b(?:\+?(\d{1,3}))?[-. ]?(\d{10})\b/,          // 10-digit Phone
  /\b(?:\d{4}[- ]?){3}\d{4}\b/,                   // 16-digit Card Number
];

// Keywords indicating completely off-topic inquiries
const OFF_TOPIC_PATTERNS = [
  /\b(write\s+a\s+poem|tell\s+me\s+a\s+joke|essay\s+on|weather\s+in|who\s+is\s+president)\b/i,
  /\b(cryptocurrency|bitcoin\s+mining|solve\s+math\s+problem)\b/i,
];

/**
 * Evaluates buyer input against Pre-Guardrails before calling the Agent.
 * @param {string} message - Raw message from buyer
 * @returns {{ passed: boolean, reason?: string, sanitizedMessage: string }}
 */
function evaluatePreGuardrail(message) {
  if (!message || typeof message !== "string") {
    return { passed: true, sanitizedMessage: "" };
  }

  const clean = message.trim();

  // 1. Injection Check
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        passed: false,
        reason: "Security violation: Prompt injection or system instruction override attempt detected.",
        sanitizedMessage: "",
      };
    }
  }

  // 2. PII Detection Check
  for (const pattern of PII_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        passed: false,
        reason: "Policy violation: Sharing personal contact information (PII) is not permitted in negotiation room.",
        sanitizedMessage: "",
      };
    }
  }

  // 3. Off-Topic Check
  for (const pattern of OFF_TOPIC_PATTERNS) {
    if (pattern.test(clean)) {
      return {
        passed: false,
        reason: "Off-topic inquiry: Please keep messages focused on B2B wholesale pricing and order procurement.",
        sanitizedMessage: "",
      };
    }
  }

  return {
    passed: true,
    sanitizedMessage: clean,
  };
}

module.exports = {
  evaluatePreGuardrail,
};
