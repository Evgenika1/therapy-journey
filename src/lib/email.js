// Kevi's own emails (purchase confirmation, welcome), sent through Resend's
// HTTP API from noreply@kevi.online. Account emails (confirm, reset) still go
// through Supabase's SMTP. Server-only: RESEND_API_KEY is a sending-only key
// limited to kevi.online.
//
// Never throws: an email that fails must not fail the payment webhook or the
// page that triggered it. Returns true when Resend accepted it.

const FROM = 'Kevi <noreply@kevi.online>';
const REPLY_TO = 'hi@kevi.online';

export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) { console.warn('[email] not sent:', !key ? 'no RESEND_API_KEY' : 'no recipient'); return false; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: JSON.stringify({ from: FROM, reply_to: REPLY_TO, to: [to], subject, html, text }),
    });
    if (!res.ok) { console.error('[email] Resend refused:', res.status, (await res.text()).slice(0, 300)); return false; }
    return true;
  } catch (e) {
    console.error('[email] send failed:', e?.message);
    return false;
  }
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function layout(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f4f7f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0A3F3D">
<div style="max-width:560px;margin:0 auto;padding:32px 24px">
<div style="font-size:26px;font-weight:600;letter-spacing:-0.02em;margin-bottom:20px">kevi</div>
<div style="background:#fff;border:1px solid #B6DAD6;border-radius:16px;padding:28px">
<h1 style="font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 16px">${esc(title)}</h1>
${bodyHtml}
</div>
<p style="font-size:12px;color:#4F827F;margin:18px 4px 0">Kevi · <a href="https://www.kevi.online/privacy" style="color:#4F827F">Privacy</a> · <a href="https://www.kevi.online/terms" style="color:#4F827F">Terms</a> · Questions? Just reply to this email.</p>
</div></body></html>`;
}
const p = t => `<p style="font-size:15px;line-height:1.6;margin:0 0 14px">${t}</p>`;
const btn = (href, label) => `<p style="margin:22px 0"><a href="${href}" style="background:#127A76;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:600;font-size:15px">${esc(label)}</a></p>`;

export function purchaseEmail({ planName, priceEur, sessions, startedAt }) {
  const date = new Date(startedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const subject = `Your Kevi ${planName} plan has started`;
  const html = layout(subject,
    p(`Thank you — your <strong>${esc(planName)}</strong> plan (€${esc(priceEur)} a month, ${esc(sessions)} sessions) started on ${esc(date)}. Your receipt from Stripe arrives separately.`) +
    `<div style="background:#EEF6F5;border-radius:12px;padding:14px 16px;margin:0 0 14px;font-size:14px;line-height:1.6">
<strong>Your request to start right away.</strong> When you subscribed, you asked us to start your plan straight away. You can still withdraw within 14 days of paying: write to <a href="mailto:hi@kevi.online" style="color:#127A76">hi@kevi.online</a>, and we refund the part of your payment for the minutes you have not used. After 14 days payments are not refunded, and you can cancel at any time to stop the next renewal. <a href="https://www.kevi.online/terms#refunds" style="color:#127A76">How refunds work</a>.</div>` +
    btn('https://www.kevi.online/sessions', 'Record a session'));
  const text = `Your Kevi ${planName} plan (€${priceEur} a month, ${sessions} sessions) started on ${date}.\n\nYou asked us to start your plan right away. You can withdraw within 14 days of paying by writing to hi@kevi.online; we then refund the part of your payment for the minutes you have not used. After 14 days payments are not refunded; you can cancel at any time to stop the next renewal. Details: https://www.kevi.online/terms#refunds`;
  return { subject, html, text };
}

export function welcomeEmail({ trialMinutes }) {
  const subject = 'Welcome to Kevi — your first session';
  const html = layout('Welcome to Kevi',
    p(`You have <strong>${esc(trialMinutes)} free minutes</strong> to try Kevi with a real session. Here is how to record an online one:`) +
    `<ol style="font-size:15px;line-height:1.7;margin:0 0 14px;padding-left:20px">
<li>Tell your therapist you’d like to record — most are glad you want to remember the session.</li>
<li>Join your call as usual (Zoom, Meet, Teams) and use your speakers, not headphones, so both voices are recorded.</li>
<li>In Kevi, press <strong>Record</strong> and allow the microphone.</li>
<li>When the session ends, press Stop. The transcript and a gentle summary follow.</li>
</ol>` +
    btn('https://www.kevi.online/', 'Open Kevi') +
    p('Kevi is a journal for the therapy you already have — not a replacement for it. If you are in crisis, please contact a local crisis line or emergency services.'));
  const text = `Welcome to Kevi. You have ${trialMinutes} free minutes.\n\n1. Tell your therapist you'd like to record.\n2. Join your call as usual and use your speakers, not headphones.\n3. In Kevi press Record and allow the microphone.\n4. Press Stop when the session ends.\n\nhttps://www.kevi.online/`;
  return { subject, html, text };
}
