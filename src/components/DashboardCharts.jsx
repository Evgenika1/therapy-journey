'use client';
//
// The two dashboard charts, as hand-written inline SVG. No chart library: the
// whole app ships zero runtime dependencies beyond React and Supabase, and the
// two shapes here (a line with range marks, a calendar grid) are a few dozen
// lines each — far less than the weight of a charting package.
//
// Both size themselves from the measured column width rather than from a
// viewBox that scales the whole drawing. A scaled viewBox shrinks the labels
// along with the plot, and at a narrow window the axis text becomes unreadable
// instead of merely tighter.

import { useState, useEffect, useRef } from 'react';
import { useTheme } from '@/lib/ThemeContext';
import {
  moodTrendPoints, heatmapGrid, heatmapDaysWithData,
  MIN_TREND_POINTS, MIN_HEATMAP_DAYS, HEATMAP_WEEKS,
} from '@/lib/chartData';

// Measured, not guessed: ResizeObserver reports the column's real width, so the
// charts follow the sidebar collapsing and the window narrowing alike.
function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect?.width;
      if (w) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

const shortDate = (iso) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// ── shared chrome ────────────────────────────────────────────────────────────

function ChartCard({ title, hint, children }) {
  const { SURFACE, BORDER, MUTED, H1: TEXT } = useTheme();
  return (
    <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 14, padding: '13px 15px', minWidth: 0 }}>
      <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 14.5, fontWeight: 400, color: TEXT, margin: '0 0 2px', lineHeight: 1.3 }}>
        {title}
      </h3>
      <p style={{ fontSize: 11, color: MUTED, margin: '0 0 10px', lineHeight: 1.4 }}>{hint}</p>
      {children}
    </div>
  );
}

// The one message for "there is not enough here yet". Deliberately an offer
// rather than an error: an empty chart on a therapy journal should not read
// like something the user got wrong.
function NotYet({ children }) {
  const { MUTED, BORDER } = useTheme();
  return (
    <div style={{
      height: 116, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: `1px dashed ${BORDER}`, borderRadius: 10, padding: '0 14px',
    }}>
      <p style={{ fontSize: 11.5, color: MUTED, margin: 0, textAlign: 'center', lineHeight: 1.5 }}>
        {children}
      </p>
    </div>
  );
}

// ── 1. mood over time ────────────────────────────────────────────────────────

export function MoodTrendChart({ pairs }) {
  const { BORDER, MUTED, H1: TEXT, SURFACE, ACCENT } = useTheme();
  const [ref, width] = useWidth();
  const points = moodTrendPoints(pairs);

  const H = 128, PAD_L = 20, PAD_R = 10, PAD_T = 10, PAD_B = 18;
  const plotW = Math.max(0, width - PAD_L - PAD_R);
  const plotH = H - PAD_T - PAD_B;

  // Spaced by session order, not by calendar distance. The question this answers
  // is "is it going up across sessions"; true date spacing would bunch a busy
  // fortnight into a smear and leave a month-long gap doing nothing.
  const x = (i) => PAD_L + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (v) => PAD_T + (1 - Math.min(10, Math.max(0, v)) / 10) * plotH;

  const enough = points.length >= MIN_TREND_POINTS;
  const line = points.map((p, i) => `${x(i)},${y(p.after)}`).join(' ');
  const area = points.length
    ? `M ${x(0)},${y(0)} ` + points.map((p, i) => `L ${x(i)},${y(p.after)}`).join(' ') + ` L ${x(points.length - 1)},${y(0)} Z`
    : '';
  const last = points[points.length - 1];

  return (
    <ChartCard title="Mood after each session" hint="Where a session leaves you, across time">
      <div ref={ref} style={{ width: '100%', minWidth: 0 }}>
        {!enough ? (
          <NotYet>Track more to see your trends over time</NotYet>
        ) : width > 0 && (
          <svg width={width} height={H} role="img"
               aria-label={`Mood after each session across ${points.length} sessions`}
               style={{ display: 'block', overflow: 'visible' }}>
            {/* Grid — recessive on purpose: it is a reference, not content. */}
            {[0, 5, 10].map(v => (
              <g key={v}>
                <line x1={PAD_L} x2={PAD_L + plotW} y1={y(v)} y2={y(v)} stroke={BORDER} strokeWidth="1" />
                <text x={PAD_L - 6} y={y(v) + 3} textAnchor="end" fontSize="9" fill={MUTED}>{v}</text>
              </g>
            ))}

            <path d={area} fill={ACCENT} opacity="0.10" />

            {/* before → after for one session: a range mark on a single datum,
                not a second series. Two teal lines would have been a palette
                the CVD check fails outright (ΔE 4 against the accent). */}
            {points.map((p, i) => (
              <line key={`r${p.id}`} x1={x(i)} x2={x(i)} y1={y(p.before)} y2={y(p.after)}
                    stroke={ACCENT} strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round" />
            ))}
            {points.map((p, i) => (
              <circle key={`b${p.id}`} cx={x(i)} cy={y(p.before)} r="2.6"
                      fill={SURFACE} stroke={ACCENT} strokeOpacity="0.55" strokeWidth="1.4" />
            ))}

            <polyline points={line} fill="none" stroke={ACCENT} strokeWidth="2"
                      strokeLinejoin="round" strokeLinecap="round" />

            {points.map((p, i) => (
              // A 2px surface ring keeps a marker legible where the line runs
              // under it. <title> is the tooltip — native, and it survives touch
              // and screen readers in a way a hand-built one would not.
              <circle key={`a${p.id}`} cx={x(i)} cy={y(p.after)} r="3.4"
                      fill={ACCENT} stroke={SURFACE} strokeWidth="1.5">
                <title>{`${shortDate(p.day)} · ${p.before} → ${p.after} (${p.diff >= 0 ? '+' : ''}${p.diff})`}</title>
              </circle>
            ))}

            {/* One direct label, on the latest point. A number on every point is
                what turns a trend line back into a table. Text wears the text
                token, never the series colour. */}
            {last && (
              <text x={Math.min(x(points.length - 1), PAD_L + plotW - 4)} y={Math.max(9, y(last.after) - 8)}
                    textAnchor="end" fontSize="10.5" fontWeight="600" fill={TEXT}>
                {last.after}
              </text>
            )}

            <text x={PAD_L} y={H - 4} fontSize="9" fill={MUTED}>{shortDate(points[0].day)}</text>
            <text x={PAD_L + plotW} y={H - 4} textAnchor="end" fontSize="9" fill={MUTED}>
              {shortDate(last.day)}
            </text>
          </svg>
        )}
      </div>
    </ChartCard>
  );
}

// ── 2. emotion heatmap ───────────────────────────────────────────────────────

// A sequential ramp: one hue, light → dark, as opacity over the card. Opacity
// rather than fixed hex steps because the accent changes three times a day —
// and on the evening surface the same steps read dark → bright without
// inverting anything, which is what a dark mode is supposed to do.
const LEVEL_OPACITY = [0, 0.16, 0.38, 0.62, 0.9];
const DAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

export function EmotionHeatmap({ emotions, today }) {
  const { BORDER, MUTED, ACCENT } = useTheme();

  const cols = heatmapGrid(emotions, today || new Date(), HEATMAP_WEEKS);
  const withData = heatmapDaysWithData(cols);

  // Fixed geometry: 8 weeks by 7 days wants to be roughly square, so stretching
  // it to a half-width card would make it 350px tall on a dashboard that was
  // just compacted. It sizes its own column instead (grid `auto`) and the trend
  // chart, which has far more to say at width, takes the rest.
  const LABEL_W = 24, TOP = 12, GAP = 3, STEP = 20;
  const cell = STEP - GAP;
  const W = LABEL_W + HEATMAP_WEEKS * STEP;
  const H = TOP + 7 * STEP + 20;
  const step = STEP;

  return (
    <ChartCard title="Emotion check-ins" hint="Last 8 weeks, by intensity">
      <div style={{ minWidth: 0 }}>
        {withData < MIN_HEATMAP_DAYS ? (
          <NotYet>Track more to see your trends over time</NotYet>
        ) : (
          <svg width={W} height={H} role="img"
               aria-label={`Emotion check-ins over the last ${HEATMAP_WEEKS} weeks, ${withData} days logged`}
               style={{ display: 'block' }}>
            {DAY_LABELS.map((label, r) => label && (
              <text key={r} x="0" y={TOP + r * step + cell - 2} fontSize="8.5" fill={MUTED}>{label}</text>
            ))}

            {cols.map((col, c) => col.map((day, r) => {
              // A future cell is drawn as nothing at all — an empty square there
              // would read as "you logged nothing", which is not true yet.
              if (day.future) return null;
              const filled = day.level > 0;
              return (
                <rect key={day.date}
                      x={LABEL_W + c * step} y={TOP + r * step}
                      width={cell} height={cell} rx="2.5"
                      fill={filled ? ACCENT : 'none'}
                      fillOpacity={filled ? LEVEL_OPACITY[day.level] : 0}
                      stroke={filled ? 'none' : BORDER} strokeWidth="1">
                  <title>
                    {`${shortDate(day.date)} · ` + (day.count
                      ? `${day.count} log${day.count > 1 ? 's' : ''}` +
                        (day.mean != null ? `, avg ${day.mean}/10` : '') +
                        (day.categories.length ? ` · ${day.categories.slice(0, 3).join(', ')}` : '')
                      : 'nothing logged')}
                  </title>
                </rect>
              );
            }))}

            {/* Sequential legend. "less → more" is the only reading a one-hue
                ramp supports, so it says exactly that and nothing more. */}
            <text x={LABEL_W} y={H - 5} fontSize="8.5" fill={MUTED}>less</text>
            {LEVEL_OPACITY.map((op, i) => (
              <rect key={i} x={LABEL_W + 26 + i * 11} y={H - 13} width="8" height="8" rx="2"
                    fill={i === 0 ? 'none' : ACCENT} fillOpacity={op}
                    stroke={i === 0 ? BORDER : 'none'} strokeWidth="1" />
            ))}
            <text x={LABEL_W + 26 + LEVEL_OPACITY.length * 11 + 4} y={H - 5} fontSize="8.5" fill={MUTED}>more</text>
          </svg>
        )}
      </div>
    </ChartCard>
  );
}
