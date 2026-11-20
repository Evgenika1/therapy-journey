// The small part of Markdown that chat replies use, parsed into plain data so
// the page can render it as React elements. No HTML is ever produced or
// injected: a reply quoting a transcript can contain anything.
//
// Blocks: paragraphs, "-"/"*"/"•" bullet lists, "1." numbered lists, "#"
// headings (shown as bold lines). Inline: **bold**, *italic* / _italic_,
// `code`. Anything else stays as written.

export function parseInline(text) {
  const out = [];
  const re = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_|`([^`]+)`)/g;
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
    if (m[2] ?? m[3]) out.push({ t: 'b', v: m[2] ?? m[3] });
    else if (m[4] ?? m[5]) out.push({ t: 'i', v: m[4] ?? m[5] });
    else out.push({ t: 'code', v: m[6] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
  return out;
}

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseBlocks(src) {
  const blocks = [];
  let para = [];
  const flush = () => { if (para.length) { blocks.push({ t: 'p', lines: para }); para = []; } };
  for (const line of String(src ?? '').split('\n')) {
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(HEADING))) { flush(); blocks.push({ t: 'h', text: m[1] }); continue; }
    const kind = (m = line.match(BULLET)) ? 'ul' : (m = line.match(NUMBER)) ? 'ol' : null;
    if (kind) {
      flush();
      const prev = blocks[blocks.length - 1];
      if (prev?.t === kind) prev.items.push(m[1]);
      else blocks.push({ t: kind, items: [m[1]] });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}
