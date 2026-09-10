// What a request cost, in dollars.
//
// The ledger's unit is money because it is the only one all four cost sources
// share: AssemblyAI bills by the hour of audio, the three Claude routes by the
// token. Minutes — the number the user sees — are derived from this at display
// time and never stored, so changing the conversion rate later cannot make the
// recorded history disagree with itself.
//
// Prices are stated per 1M tokens, matching how Anthropic publishes them, and
// the cost is computed at write time. Recomputing an old row against today's
// price list would quietly rewrite what last month actually cost.

// ─────────────────────────────────────────────────────────────────────────────
// TODO — SET THIS FROM YOUR ASSEMBLYAI INVOICE BEFORE TRUSTING ANY NUMBER.
//
// This is a placeholder, not a quote. Transcription is the largest single cost
// in the app — larger than every Claude call combined — so it sets the exchange
// rate for the whole "minutes" display. Read the real per-hour figure off your
// AssemblyAI billing page and put it here; until then every minutes balance in
// the UI is proportional to a made-up number.
export const ASSEMBLYAI_USD_PER_HOUR = 0.37;
// ─────────────────────────────────────────────────────────────────────────────

// USD per 1M tokens. The routes currently send the dated snapshot id, so both
// spellings are listed — a model id missing here throws rather than billing at
// zero, and the test suite pins that every id the app actually sends is present.
const HAIKU_4_5 = { input: 1.00, output: 5.00 };

export const MODEL_PRICES = {
  'claude-haiku-4-5':          HAIKU_4_5,
  'claude-haiku-4-5-20251001': HAIKU_4_5,
};

// Reads from the cache are billed at a fraction of the input rate; writing to it
// costs a little more than an ordinary input token. Neither path is used by the
// app yet — the routes send no cache_control — but the fields arrive in `usage`
// and would otherwise be dropped from the bill the day caching is turned on.
export const CACHE_READ_MULTIPLIER  = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

const perMillion = (tokens, rate) => (num(tokens) / 1_000_000) * rate;
const num = v => (Number.isFinite(v) && v > 0 ? v : 0);

// Throws on an unpriced model. The caller decides what to do — the routes log
// the failure and record the token counts with a zero cost, so the anomaly is
// visible in the admin view rather than silently absorbed into the totals.
export function claudeCost({
  model,
  input_tokens,
  output_tokens,
  cache_read_input_tokens,
  cache_creation_input_tokens,
} = {}) {
  const price = MODEL_PRICES[model];
  if (!price) throw new Error(`No price for model "${model}" — add it to MODEL_PRICES`);

  return perMillion(input_tokens,  price.input)
       + perMillion(output_tokens, price.output)
       + perMillion(cache_read_input_tokens,     price.input * CACHE_READ_MULTIPLIER)
       + perMillion(cache_creation_input_tokens, price.input * CACHE_WRITE_MULTIPLIER);
}

// Duration comes from AssemblyAI's own `audio_duration`, never from the browser:
// the client's timer is what the user's tab thinks happened, and it is trivially
// forgeable by anyone who wants free transcription.
export function audioCost(seconds) {
  return (num(seconds) / 3600) * ASSEMBLYAI_USD_PER_HOUR;
}
