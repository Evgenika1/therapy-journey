// Layered rescue for text that should already be valid JSON. Kept as a safety
// net for the case where the response somehow arrives unconstrained: strip a
// markdown fence, then take the outermost balanced {...} — a plain greedy
// first-{-to-last-} regex still fails on a truncated object, which is what
// produced the bare "Could not parse Claude response".
export function parseAnalysis(raw) {
  const text = (raw || '').trim();
  if (!text) return null;

  const unfenced = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  for (const candidate of [text, unfenced]) {
    try { return JSON.parse(candidate); } catch { /* try the next shape */ }
  }

  // Scan for the first balanced object, ignoring braces inside strings —
  // Russian text with quotes and escapes broke naive brace matching.
  const start = unfenced.indexOf('{');
  if (start === -1) return null;
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < unfenced.length; i++) {
    const ch = unfenced[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(unfenced.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null; // unbalanced — the object was cut off mid-flight
}
