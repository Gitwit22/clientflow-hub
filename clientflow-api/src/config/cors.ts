/**
 * Request headers the browser app may send cross-origin. A header missing here fails the CORS
 * preflight, and the browser reports "Failed to fetch" without the request ever reaching the API.
 */
export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'X-Request-Id',
  'X-App-Partition',
  // Sent by every "Send" action (form, intake, contract, welcome, signed copy) to dedupe retries.
  'Idempotency-Key',
];
