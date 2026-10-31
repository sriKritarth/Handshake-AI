/**
 * SSE Message Formatter (MDN Standard)
 * Formats event payload into the Server-Sent Events text protocol.
 * Standard format:
 *   id: <id>\n
 *   event: <event>\n
 *   data: <line 1>\n
 *   data: <line 2>\n\n
 *
 * Per MDN Specification:
 * If the data string contains newlines, every line must be prefixed
 * with "data: " to ensure the client-side EventSource does not drop lines.
 */
function formatSseMessage({ event, data, id } = {}) {
  let message = "";

  if (id !== undefined && id !== null) {
    message += `id: ${id}\n`;
  }

  if (event !== undefined && event !== null && String(event).trim().length > 0) {
    message += `event: ${event}\n`;
  }

  const payload = typeof data === "string" ? data : JSON.stringify(data !== undefined ? data : null);
  const lines = String(payload).split("\n");
  for (const line of lines) {
    message += `data: ${line}\n`;
  }
  message += "\n";

  return message;
}

module.exports = {formatSseMessage};
