// What a link from one of our auth emails is asking for.
//
// The email templates point at /auth/confirm?token_hash=…&type=… (see
// app/auth/confirm). A token_hash is verified by this page, in the browser that
// opened it — unlike Supabase's default ?code= links, which only work in the
// browser that asked for the email, and unlike its /verify links, which a
// mail scanner fetching the URL can use up before the person clicks.
//
// Links already sent with the old templates still arrive: as ?code=… or, when
// Supabase refused the token, as ?error=… or #error=… on whatever page it
// redirected to. Pure: takes the search and hash strings, returns a plan.

export const LINK_TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];

const params = (s) => new URLSearchParams((s || '').replace(/^[?#]/, ''));

export function parseAuthLink(search = '', hash = '') {
  const q = params(search);
  const h = params(hash);
  const get = (k) => q.get(k) ?? h.get(k);

  const errorCode = get('error_code') || get('error');
  if (errorCode) {
    return {
      kind: 'error',
      errorCode,
      expired: /expired|invalid|otp/i.test(`${errorCode} ${get('error_description') || ''}`),
      type: LINK_TYPES.includes(get('type')) ? get('type') : null,
    };
  }

  const type = get('type');
  const tokenHash = q.get('token_hash');
  if (tokenHash) {
    if (!LINK_TYPES.includes(type)) return { kind: 'error', errorCode: 'bad_type', expired: false, type: null };
    return { kind: 'token', tokenHash, type };
  }

  const code = q.get('code');
  if (code) return { kind: 'code', code, type: LINK_TYPES.includes(type) ? type : null };

  return { kind: 'none' };
}

// Whether a URL carries an auth error worth sending to /auth/confirm, so a dead
// link says so instead of silently landing on the dashboard.
export function hasAuthError(search = '', hash = '') {
  return parseAuthLink(search, hash).kind === 'error';
}

export const EXPIRED_MESSAGE =
  'This link has expired or has already been used. Links from our emails work once and for about an hour.';
