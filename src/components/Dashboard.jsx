'use client';

import { useState } from 'react';

// ─── Design tokens ────────────────────────────────────────────────────────────
// Colors: cream bg, orange + yellow accents, warm text
// Fonts: DM Serif Display (headings) + DM Sans (body) + Courier Prime (labels)
// Add to globals.css:
//   @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@300;400;500;600;700&family=Courier+Prime:wght@400;700&display=swap');

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const TODAY_INDEX = 3; // Wednesday

export default function Dashboard({ user = { name: 'Eva' } }) {
  const [activePeriod, setActivePeriod] = useState('1m');

  // Generate this week's dates starting from Monday
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - today.getDay() + 1);
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.getDate();
  });

  const metrics = [
    { icon: '❤', label: 'Sessions', value: '12', note: '01 — total', accent: '#F07040', bg: '#FFF0EB' },
    { icon: '▲', label: 'Mood Lift', value: '+2.1', note: '02 — avg', accent: '#F5C842', bg: '#FFF8E0' },
    { icon: '★', label: 'Insights', value: '5', note: '03 — recorded', accent: '#F5C842', bg: '#FFFAE8' },
    { icon: '◎', label: 'Streak', value: '4', note: '04 — weeks', accent: '#F07040', bg: '#FFF0E8' },
  ];

  const recentSessions = [
    { title: 'Perfectionism · AI Analysis', date: 'Mar 15, 2026', mood: '+3 mood', color: '#F07040' },
    { title: 'Work stress · AI Analysis', date: 'Mar 13, 2026', mood: '+2 mood', color: '#E8A820' },
    { title: 'Family patterns · AI Analysis', date: 'Mar 10, 2026', mood: '+1 mood', color: '#F5C842' },
  ];

  return (
    <div
      className="relative min-h-screen overflow-x-hidden"
      style={{ background: '#F5F0EA', fontFamily: "'DM Sans', sans-serif" }}
    >
      {/* ── Warm orb glows ── */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div
          className="absolute rounded-full"
          style={{
            width: 400, height: 380,
            bottom: 40, right: -60,
            background: 'radial-gradient(circle, rgba(240,112,64,0.18) 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: 320, height: 280,
            bottom: 80, left: -40,
            background: 'radial-gradient(circle, rgba(245,200,66,0.22) 0%, transparent 70%)',
          }}
        />
        <div
          className="absolute rounded-full"
          style={{
            width: 200, height: 180,
            bottom: 300, left: '40%',
            background: 'radial-gradient(circle, rgba(232,168,32,0.14) 0%, transparent 70%)',
          }}
        />
      </div>

      {/* ── BREAK vertical label ── */}
      <div
        className="pointer-events-none fixed right-1 top-1/2 z-0 -translate-y-1/2 rotate-90 whitespace-nowrap"
        style={{ fontFamily: "'Courier Prime', monospace", fontSize: 9, letterSpacing: '3px', color: 'rgba(240,112,64,0.18)' }}
      >
        T H E R A P Y &nbsp; J O U R N E Y &nbsp; S Y S T E M
      </div>

      {/* ── Main content ── */}
      <div className="relative z-10 mx-auto max-w-md px-4 pb-24">

        {/* ── Nav ── */}
        <div className="flex items-center justify-between pt-5 pb-2">
          <div className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ background: '#F07040' }}
            >
              <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 10, fontWeight: 700, color: 'white' }}>tj</span>
            </div>
            <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 11, letterSpacing: '3px', color: '#2C1A0E' }}>
              T H E R A P Y ™
            </span>
          </div>

          {/* Period selector pill */}
          <div
            className="flex items-center gap-1 rounded-full p-1"
            style={{ background: 'rgba(245,200,66,0.15)', border: '0.5px solid rgba(245,200,66,0.35)' }}
          >
            {['1m', '3m', 'all'].map((p) => (
              <button
                key={p}
                onClick={() => setActivePeriod(p)}
                className="rounded-full px-3 py-1 transition-all"
                style={{
                  fontFamily: "'Courier Prime', monospace",
                  fontSize: 9,
                  letterSpacing: '1px',
                  background: activePeriod === p ? '#F5C842' : 'transparent',
                  color: activePeriod === p ? '#2C1A0E' : '#A09080',
                }}
              >
                {p.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Notification bell */}
          <div className="relative">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ background: 'white', boxShadow: '0 2px 8px rgba(44,26,14,0.08)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A09080" strokeWidth="1.8">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </div>
            <div
              className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
              style={{ background: '#F07040', border: '1.5px solid #F5F0EA' }}
            />
          </div>
        </div>

        {/* Artifact label */}
        <p style={{ fontFamily: "'Courier Prime', monospace", fontSize: 9, letterSpacing: '1px', color: '#A09080' }} className="mb-2">
          Artifact ID 001 — Daily View
        </p>

        {/* ── Greeting — dashed BREAK box ── */}
        <div className="relative mb-4 rounded-xl p-4" style={{
          border: '1px dashed rgba(245,200,66,0.5)',
          background: 'rgba(255,255,255,0.45)',
        }}>
          {/* Corner dots */}
          {[['top-0 left-0', '#F5C842'], ['top-0 right-0', '#F5C842'], ['bottom-0 left-0', '#F07040'], ['bottom-0 right-0', '#F07040']].map(([pos, col]) => (
            <div key={pos} className={`absolute -translate-x-0.5 -translate-y-0.5 h-1.5 w-1.5 rounded-full ${pos}`} style={{ background: col }} />
          ))}
          {/* Yellow-orange top bar */}
          <div className="absolute left-5 right-5 top-0 h-0.5 rounded" style={{ background: 'linear-gradient(90deg, #F5C842, #F07040)' }} />

          <div className="mb-1 flex items-center gap-1.5" style={{ color: '#A09080', fontSize: 11 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#F5C842" strokeWidth="2">
              <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2" />
            </svg>
            Good Morning!
          </div>
          <h1 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 30, color: '#2C1A0E', lineHeight: 1.15 }}>
            Selamat<br />Datang, {user.name}! 👋
          </h1>
          <p style={{ fontFamily: "'Courier Prime', monospace", fontSize: 9, letterSpacing: '1px', color: '#A09080', marginTop: 6 }}>
            01 — how are you feeling today?
          </p>
        </div>

        {/* ── Week calendar strip ── */}
        <div className="mb-4 flex justify-between px-1">
          {DAYS.map((d, i) => {
            const isToday = i === TODAY_INDEX;
            return (
              <div key={i} className="flex flex-col items-center gap-1">
                <span style={{ fontSize: 11, color: '#C0B0A0' }}>{d}</span>
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full transition-all cursor-pointer"
                  style={{ background: isToday ? '#F5C842' : 'transparent' }}
                >
                  <span style={{ fontSize: 12, fontWeight: isToday ? 600 : 400, color: '#2C1A0E' }}>
                    {weekDates[i]}
                  </span>
                </div>
                <div className="h-1 w-1 rounded-full" style={{ background: isToday ? '#F07040' : 'transparent' }} />
              </div>
            );
          })}
        </div>

        {/* ── Hero card — yellow → orange gradient ── */}
        <div className="relative mb-3 overflow-hidden rounded-2xl p-5" style={{ minHeight: 150 }}>
          {/* Gradient background */}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(135deg, #F5C842 0%, #F09030 50%, #E84820 100%)' }} />
          {/* Geometric shapes */}
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 368 150" preserveAspectRatio="xMidYMid slice">
            <polygon points="290,8 345,8 368,45 368,8" fill="rgba(255,255,255,0.13)" />
            <polygon points="315,0 368,0 368,75" fill="rgba(255,255,255,0.08)" />
            <ellipse cx="330" cy="100" rx="65" ry="60" fill="rgba(255,220,120,0.2)" />
            <polygon points="255,128 308,85 368,108 368,150 255,150" fill="rgba(255,255,255,0.07)" />
            <polygon points="40,20 46,32 34,32" fill="rgba(255,255,200,0.25)" />
            <circle cx="28" cy="50" r="5" fill="rgba(255,255,180,0.2)" />
          </svg>
          <div className="relative z-10">
            <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', marginBottom: 4 }}>Your Progress</p>
            <h2 style={{ fontFamily: "'DM Serif Display', Georgia, serif", fontSize: 28, color: 'white', letterSpacing: '-0.5px', marginBottom: 12 }}>
              12 Sessions
            </h2>
            <div className="flex items-center justify-between rounded-xl px-4 py-2.5" style={{ background: 'rgba(255,255,255,0.2)' }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>Mood lift avg</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'white' }}>+2.1 ↑</span>
            </div>
          </div>
        </div>

        {/* Detail button */}
        <button
          className="mb-4 w-full rounded-xl py-3 text-center transition-opacity hover:opacity-80 active:scale-[0.98]"
          style={{ background: '#F5C842' }}
        >
          <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 10, letterSpacing: '2px', color: '#2C1A0E' }}>
            ↳ LIHAT STATISTIK LEBIH DETAIL
          </span>
        </button>

        {/* ── Section label ── */}
        <div className="mb-3 flex items-center justify-between">
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#2C1A0E' }}>Session Overview</h3>
          <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 9, letterSpacing: '1px', color: '#A09080' }}>
            17.03 — 26
          </span>
        </div>

        {/* ── Metric cards ── */}
        <div className="mb-4 grid grid-cols-2 gap-2.5">
          {metrics.map((m) => (
            <div
              key={m.label}
              className="rounded-2xl bg-white p-3.5 transition-transform hover:scale-[1.02]"
              style={{
                boxShadow: '0 2px 10px rgba(44,26,14,0.06)',
                borderTop: `2px solid ${m.accent}`,
              }}
            >
              <div
                className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl"
                style={{ background: m.bg }}
              >
                <span style={{ fontSize: 16, color: m.accent }}>{m.icon}</span>
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#2C1A0E', marginBottom: 1 }}>{m.value}</div>
              <div style={{ fontSize: 12, fontWeight: 500, color: '#2C1A0E', marginBottom: 2 }}>{m.label}</div>
              <div style={{ fontFamily: "'Courier Prime', monospace", fontSize: 9, letterSpacing: '0.5px', color: '#A09080' }}>{m.note}</div>
            </div>
          ))}
        </div>

        {/* ── Recent sessions card ── */}
        <div className="mb-4 rounded-2xl bg-white p-4" style={{ boxShadow: '0 2px 12px rgba(44,26,14,0.06)' }}>
          <div className="mb-2.5 flex items-center justify-between">
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#2C1A0E' }}>Recent Sessions</h3>
            <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 9, letterSpacing: '1px', color: '#A09080' }}>↳ TERKINI</span>
          </div>
          <div className="mb-3 h-px" style={{ background: 'rgba(44,26,14,0.07)' }} />

          {/* BREAK dashed insight box */}
          <div className="relative mb-3 rounded-lg p-3" style={{
            border: '1px dashed rgba(245,200,66,0.45)',
            background: 'rgba(245,200,66,0.05)',
          }}>
            {[['top-0 left-0', '#F5C842'], ['top-0 right-0', '#F5C842'], ['bottom-0 left-0', '#F07040'], ['bottom-0 right-0', '#F07040']].map(([pos, col]) => (
              <div key={pos} className={`absolute h-1 w-1 rounded-full ${pos} -translate-x-0.5 -translate-y-0.5`} style={{ background: col }} />
            ))}
            <p style={{ fontSize: 12, fontStyle: 'italic', color: '#2C1A0E', lineHeight: 1.55, fontWeight: 300, marginBottom: 6 }}>
              "You recognized that your reaction to criticism comes from early expectations."
            </p>
            <p style={{ fontFamily: "'Courier Prime', monospace", fontSize: 9, letterSpacing: '1px', color: '#A09080' }}>
              02 — Mar 15 · surface coherence detected
            </p>
          </div>

          {recentSessions.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2 transition-colors hover:bg-orange-50/30 rounded-lg px-1 cursor-pointer"
              style={{ borderTop: i > 0 ? '0.5px solid rgba(44,26,14,0.06)' : 'none' }}
            >
              <div>
                <p style={{ fontSize: 12, fontWeight: 500, color: '#2C1A0E' }}>{s.title}</p>
                <p style={{ fontFamily: "'Courier Prime', monospace", fontSize: 9, color: '#A09080', marginTop: 2 }}>↳ {s.date}</p>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: s.color }}>{s.mood}</span>
            </div>
          ))}
        </div>

        {/* ── Phase marker ── */}
        <div className="mb-4 flex items-center justify-between">
          <div
            className="rounded-md px-3 py-1.5"
            style={{ border: '1px solid rgba(245,200,66,0.5)', background: 'rgba(245,200,66,0.08)' }}
          >
            <p style={{ fontFamily: "'Courier Prime', monospace", fontSize: 8, letterSpacing: '1.5px', color: '#A09080', marginBottom: 1 }}>
              CURRENT PHASE MARKER
            </p>
            <p style={{ fontFamily: "'Courier Prime', monospace", fontSize: 11, color: '#2C1A0E' }}>17 · 03 · 26</p>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 9, letterSpacing: '2px', color: '#E8A820' }}>STABLE</span>
            <div className="h-3.5 w-px" style={{ background: 'rgba(245,200,66,0.35)' }} />
            <span style={{ fontFamily: "'Courier Prime', monospace", fontSize: 9, letterSpacing: '2px', color: '#A09080' }}>OVERLOAD</span>
          </div>
        </div>

      </div>

      {/* ── Bottom nav — fixed ── */}
      <div className="fixed bottom-0 left-0 right-0 z-20 flex justify-center pb-4 pt-2">
        <div
          className="mx-4 flex w-full max-w-md items-center justify-around rounded-full px-7 py-2"
          style={{ background: 'white', boxShadow: '0 -2px 20px rgba(44,26,14,0.1)' }}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full" style={{ background: '#F5C842' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
          </div>
          {[
            <path key="sessions" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />,
            <><path key="p1" d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" /></>,
            <><circle key="c1" cx="12" cy="8" r="4" /><path key="p2" d="M4 20c0-4 3.6-7 8-7s8 3 8 7" /></>,
          ].map((icon, i) => (
            <button key={i} className="flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-orange-50">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#C0B0A0" strokeWidth="1.5">{icon}</svg>
            </button>
          ))}
        </div>
      </div>

      {/* ── Fluffy creature — fixed bottom ── */}
      <div className="pointer-events-none fixed bottom-14 left-1/2 -translate-x-1/2 z-10">
        <svg width="80" height="55" viewBox="0 0 130 88">
          <ellipse cx="65" cy="78" rx="50" ry="30" fill="#C86010" />
          <ellipse cx="65" cy="56" rx="42" ry="30" fill="#E07820" />
          <ellipse cx="40" cy="64" rx="13" ry="17" fill="#D06818" transform="rotate(-20,40,64)" />
          <ellipse cx="90" cy="64" rx="13" ry="17" fill="#D06818" transform="rotate(20,90,64)" />
          <ellipse cx="26" cy="74" rx="9" ry="12" fill="#C05010" transform="rotate(-30,26,74)" />
          <ellipse cx="104" cy="74" rx="9" ry="12" fill="#C05010" transform="rotate(30,104,74)" />
          <ellipse cx="52" cy="46" rx="11" ry="15" fill="#F5C842" transform="rotate(-15,52,46)" />
          <ellipse cx="78" cy="46" rx="11" ry="15" fill="#F5C842" transform="rotate(15,78,46)" />
          <ellipse cx="65" cy="42" rx="10" ry="13" fill="#F8D050" />
          <circle cx="55" cy="59" r="4" fill="white" />
          <circle cx="75" cy="59" r="4" fill="white" />
          <circle cx="56" cy="60" r="2" fill="#2C1008" />
          <circle cx="76" cy="60" r="2" fill="#2C1008" />
          <circle cx="57" cy="59" r="1" fill="white" />
          <circle cx="77" cy="59" r="1" fill="white" />
        </svg>
      </div>

    </div>
  );
}
