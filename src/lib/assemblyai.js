// Shared AssemblyAI transport for both transcription routes.
//
// Why this exists: a 91-minute recording (84.7 MB) died mid-upload with
//   TypeError: fetch failed  ←  cause: Error: write EPIPE
// after 25 minutes. EPIPE means the remote closed the socket while we were still
// writing the body — the upload was simply too slow to survive, and Node's fetch
// reported only the useless "fetch failed" because the real reason hides in
// err.cause. So: unwrap the cause, and retry the upload when the failure is a
// transport hiccup rather than a rejection.

// Socket/DNS failures worth a second attempt. A 4xx from AssemblyAI is NOT here:
// re-sending 85 MB to be rejected again helps nobody.
const TRANSIENT_CODES = new Set([
  'EPIPE', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETDOWN', 'ENETUNREACH',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
]);

const causeCode = err => err?.cause?.code || err?.code || null;
export const isTransient = err => TRANSIENT_CODES.has(causeCode(err));

// Node's fetch collapses every transport failure into a bare "fetch failed" and
// buries the reason in err.cause. Unwrap it so logs and UI say something useful.
export async function aaiFetch(url, init, step, tag = 'aai') {
  try {
    return await fetch(url, init);
  } catch (err) {
    const cause = err?.cause;
    console.error(`[${tag}] ${step} — fetch threw:`, err.message, '| cause:', cause);
    const wrapped = new Error(`${step}: ${cause?.code || cause?.message || err.message}`);
    wrapped.cause = cause;
    throw wrapped;
  }
}
