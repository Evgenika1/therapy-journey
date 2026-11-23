import { ImageResponse } from 'next/og';

// The picture shown when a kevi.online link is shared (messengers, social
// posts, ads). Drawn here so it always matches the landing page's message.
export const alt = 'Kevi — remember every therapy session';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '72px 80px', background: 'linear-gradient(135deg, #0A3F3D 0%, #127A76 100%)', color: '#FFFFFF', fontFamily: 'Georgia, serif' }}>
        <div style={{ fontSize: 44, fontFamily: 'sans-serif', fontWeight: 600, letterSpacing: '-0.02em' }}>kevi</div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 76, lineHeight: 1.08 }}>Remember every session.</div>
          <div style={{ fontSize: 76, lineHeight: 1.08, fontStyle: 'italic', color: '#F4C9A0' }}>Grow between them.</div>
        </div>
        <div style={{ fontSize: 30, fontFamily: 'sans-serif', opacity: 0.85 }}>Transcripts and gentle summaries of online therapy · 30 free minutes</div>
      </div>
    ),
    size,
  );
}
