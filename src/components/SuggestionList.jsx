'use client';
//
// The list of starter questions, in the one place both chat surfaces read from.
//
// It renders in four spots — the empty state and the in-thread toggle, on the
// session panel and on the standalone AI Chat screen — and each of those needs
// the same "show the first few, offer the rest" behaviour. Four copies of that
// would drift apart on the first edit to one of them, which is exactly what
// happened to the suggestions themselves before they moved to lib/chatPresets.

import { useState } from 'react';
import { useTheme } from '@/lib/ThemeContext';
import { CHAT_SUGGESTIONS, SUGGESTION_PREVIEW } from '@/lib/chatPresets';

export default function SuggestionList({ onPick, disabled = false, compact = false }) {
  const { BG, SURFACE, BORDER, MUTED, H1: TEXT, CORAL: A } = useTheme();
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? CHAT_SUGGESTIONS : CHAT_SUGGESTIONS.slice(0, SUGGESTION_PREVIEW);
  const hidden  = CHAT_SUGGESTIONS.length - SUGGESTION_PREVIEW;

  // The session panel is 320px wide; the AI Chat column is roughly double that.
  const size = compact
    ? { pad: '7px 10px', font: 11.5, gap: 5, radius: 8,  icon: 11 }
    : { pad: '10px 13px', font: 13,   gap: 7, radius: 10, icon: 13 };

  return (
    // A fragment: the scrolling list and the "Show fewer" control are siblings,
    // because a toggle inside the scroll box scrolls away from the reader who
    // needs it.
    <>
    <div style={{
      display: 'flex', flexDirection: 'column', gap: size.gap, minWidth: 0,
      // Expanded, the full list is longer than any panel wants to be, so it
      // scrolls in place instead of pushing the input off the screen. Collapsed
      // it is four rows and needs no cap at all.
      ...(showAll ? { maxHeight: compact ? 240 : 300, overflowY: 'auto', paddingRight: 2 } : {}),
    }}>
      {visible.map(q => (
        <button key={q} onClick={() => onPick(q)} disabled={disabled}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: size.pad, borderRadius: size.radius,
            border: `1px solid ${BORDER}`, background: compact ? BG : SURFACE,
            color: TEXT, fontSize: size.font, lineHeight: 1.4,
            cursor: disabled ? 'default' : 'pointer', textAlign: 'left',
            fontFamily: 'inherit', minWidth: 0,
          }}
          onMouseEnter={e => { if (!disabled) e.currentTarget.style.borderColor = A + '55'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = BORDER; }}>
          <span style={{ flexShrink: 0, fontSize: size.icon }}>✦</span>
          <span style={{ minWidth: 0 }}>{q}</span>
        </button>
      ))}

      {hidden > 0 && !showAll && (
        <button onClick={() => setShowAll(true)}
          style={{
            alignSelf: 'flex-start', marginTop: 1, background: 'none', border: 'none',
            padding: '2px 0', color: MUTED, fontSize: compact ? 11 : 12,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
          {`${hidden} more…`}
        </button>
      )}
    </div>
    {showAll && (
      <button onClick={() => setShowAll(false)}
        style={{
          alignSelf: 'flex-start', marginTop: 6, background: 'none', border: 'none',
          padding: '2px 0', color: MUTED, fontSize: compact ? 11 : 12,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
        Show fewer
      </button>
    )}
    </>
  );
}
