// Data shaping for the two dashboard charts.
//
// Pure functions: no React, no network, no clock of its own. The reference day
// is always passed in, which is what makes the heatmap's week boundaries and
// its "future" cells testable rather than a thing that only breaks on Sundays.

export const MIN_TREND_POINTS = 3;   // below this the charts offer to wait
export const MIN_HEATMAP_DAYS = 3;
export const HEATMAP_WEEKS    = 8;

// ── mood trend ───────────────────────────────────────────────────────────────

// Number(null) is 0 and Number('') is 0, so a session that never recorded a
// mood after would pass a bare isFinite check and be plotted as a crash to
// zero — the most alarming shape this chart can draw, from missing data.
const score = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// moodPairs arrives newest-first (that is the order the Session Impact list
// wants). A time axis needs the opposite, and a pair missing either end of the
// session cannot be drawn at all.
export function moodTrendPoints(pairs = []) {
  return (Array.isArray(pairs) ? pairs : [])
    .filter(p => p && p.day
      && Number.isFinite(score(p.before))
      && Number.isFinite(score(p.after)))
    .map(p => ({
      id:     p.id,
      day:    p.day,
      before: score(p.before),
      after:  score(p.after),
      diff:   score(p.after) - score(p.before),
    }))
    .sort((a, b) => String(a.day).localeCompare(String(b.day)));
}

// ── emotion heatmap ──────────────────────────────────────────────────────────

// Local calendar day. created_at is stored UTC and the rest of the app already
// reads its day with slice(0, 10) (see patternsInput), so a log written late in
// the evening lands on the UTC date. Matching that here keeps one definition of
// "which day was this" across the app rather than two that disagree by one.
const isoDay = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Weeks start on Monday: the app's users are not in the US, and a week that
// starts on Sunday reads as off-by-one to everyone else.
export function mondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// Intensity is 1–10. Four filled levels, because a sequential ramp with more
// steps than that stops being readable at 11px per cell.
export function levelFor(mean) {
  if (!Number.isFinite(mean) || mean <= 0) return 0;
  if (mean <= 3) return 1;
  if (mean <= 5) return 2;
  if (mean <= 7) return 3;
  return 4;
}

// Columns of weeks, each 7 cells Monday→Sunday, oldest week first — the shape a
// GitHub-style grid renders straight out of.
export function heatmapGrid(emotions = [], today = new Date(), weeks = HEATMAP_WEEKS) {
  const byDay = new Map();
  for (const e of (Array.isArray(emotions) ? emotions : [])) {
    const key = typeof e?.created_at === 'string' ? e.created_at.slice(0, 10) : null;
    if (!key) continue;
    const cur = byDay.get(key) || { count: 0, sum: 0, rated: 0, categories: [] };
    cur.count += 1;
    // An unrated log still marks the day as used; it just cannot move the mean.
    if (Number.isFinite(Number(e.intensity))) { cur.sum += Number(e.intensity); cur.rated += 1; }
    if (e.category && !cur.categories.includes(e.category)) cur.categories.push(e.category);
    byDay.set(key, cur);
  }

  const start = mondayOf(today);
  start.setDate(start.getDate() - (weeks - 1) * 7);
  const todayKey = isoDay(today instanceof Date ? today : new Date(today));

  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const cur = new Date(start);
      cur.setDate(start.getDate() + w * 7 + d);
      const date = isoDay(cur);
      const agg  = byDay.get(date);
      const mean = agg && agg.rated ? agg.sum / agg.rated : null;
      col.push({
        date,
        future: date > todayKey,
        count:  agg?.count ?? 0,
        mean:   mean == null ? null : Math.round(mean * 10) / 10,
        categories: agg?.categories ?? [],
        level:  agg ? (mean == null ? 1 : levelFor(mean)) : 0,
      });
    }
    cols.push(col);
  }
  return cols;
}

// How many days in the grid actually carry a log — what decides between drawing
// the map and offering to wait for more.
export function heatmapDaysWithData(cols = []) {
  return cols.flat().filter(c => c.count > 0).length;
}
