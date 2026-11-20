'use client';
import { Fragment } from 'react';
import { parseBlocks, parseInline } from '@/lib/chatMarkdown';

// Renders a chat reply's light Markdown (see chatMarkdown.js) as elements.
function Inline({ text }) {
  return parseInline(text).map((s, i) =>
    s.t === 'b' ? <strong key={i}>{s.v}</strong>
    : s.t === 'i' ? <em key={i}>{s.v}</em>
    : s.t === 'code' ? <code key={i} style={{ fontSize: '0.92em' }}>{s.v}</code>
    : <Fragment key={i}>{s.v}</Fragment>);
}

export default function ChatText({ text }) {
  const blocks = parseBlocks(text);
  return blocks.map((b, i) => {
    const gap = { margin: i === 0 ? 0 : '0.6em 0 0' };
    if (b.t === 'h') return <p key={i} style={{ ...gap, fontWeight: 600 }}><Inline text={b.text} /></p>;
    if (b.t === 'ul' || b.t === 'ol') {
      const List = b.t;
      return (
        <List key={i} style={{ ...gap, paddingLeft: '1.3em' }}>
          {b.items.map((it, j) => <li key={j} style={{ marginTop: j ? 4 : 0 }}><Inline text={it} /></li>)}
        </List>
      );
    }
    return (
      <p key={i} style={gap}>
        {b.lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}<Inline text={l} /></Fragment>)}
      </p>
    );
  });
}
