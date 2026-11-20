// What Sentry may see. Kevi holds therapy recordings, transcripts and diaries
// (GDPR Art. 9 health data), so error reports carry only what is needed to
// find the bug in the code: the error, where it happened, the browser. No
// request bodies, headers, cookies, query strings, user identity, console
// output or clicked text, and email addresses are masked wherever they appear.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const MAX_TEXT = 300;

function clean(text) {
  if (typeof text !== 'string') return text;
  const masked = text.replace(EMAIL, '[email]');
  return masked.length > MAX_TEXT ? `${masked.slice(0, MAX_TEXT)}…` : masked;
}

function stripQuery(url) {
  if (typeof url !== 'string') return url;
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

export function scrubBreadcrumb(crumb) {
  if (!crumb) return crumb;
  if (crumb.category === 'console') return null;
  const out = { ...crumb };
  if (out.category?.startsWith('ui.')) delete out.message;
  else if (out.message) out.message = clean(out.message);
  if (out.data) {
    const data = {};
    for (const key of ['url', 'from', 'to', 'method', 'status_code']) {
      if (key in out.data) data[key] = stripQuery(out.data[key]);
    }
    out.data = data;
  }
  return out;
}

export function scrubEvent(event) {
  if (!event) return event;
  if (event.request) event.request = { url: stripQuery(event.request.url) };
  delete event.user;
  delete event.extra;
  delete event.server_name;
  if (event.message) event.message = clean(event.message);
  for (const ex of event.exception?.values ?? []) ex.value = clean(ex.value);
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb).filter(Boolean);
  }
  return event;
}

// Shared by browser, server and edge. Off unless a DSN is set, so local dev
// and tests never report anything.
export function sentryOptions() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV || 'development',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
