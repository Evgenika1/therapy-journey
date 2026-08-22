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

// Upload raw audio bytes, retrying transport failures with a short backoff.
// Returns AssemblyAI's upload_url.
export async function uploadAudio(base, apiKey, audioBuffer, { attempts = 3, tag = 'aai' } = {}) {
  const mb = (audioBuffer.length / 1024 / 1024).toFixed(1);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      console.log(`[${tag}] uploading ${mb} MB to AssemblyAI (attempt ${attempt}/${attempts})...`);
      const res = await aaiFetch(`${base}/v2/upload`, {
        method: 'POST',
        headers: { authorization: apiKey, 'content-type': 'application/octet-stream' },
        body: audioBuffer,
      }, 'Загрузка в AssemblyAI', tag);
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(`[${tag}] AAI upload response: ${res.status} in ${secs}s`);
      if (!res.ok) throw new Error(`Upload failed (${res.status}): ${await res.text()}`);
      const { upload_url } = await res.json();
      return upload_url;
    } catch (err) {
      const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
      const last = attempt === attempts;
      if (!isTransient(err) || last) {
        console.error(`[${tag}] upload failed after ${secs}s (attempt ${attempt}):`, err.message);
        if (isTransient(err)) {
          // Say what actually happened — "fetch failed" told the user nothing.
          throw new Error(
            `Не удалось передать аудио в AssemblyAI: соединение оборвалось (${causeCode(err)}) ` +
            `после ${secs} с на ${mb} МБ. Похоже на слишком медленную/нестабильную сеть для файла такого размера.`
          );
        }
        throw err;
      }
      const backoff = 2000 * attempt;
      console.warn(`[${tag}] transient ${causeCode(err)} after ${secs}s — retrying in ${backoff}ms`);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
}
