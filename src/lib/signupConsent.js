// The explicit consent asked for when an account is created.
//
// Session content can reveal health information, a special category under
// Art. 9 GDPR, so processing it rests on explicit consent, and that consent has
// to be demonstrable later. The box is required to sign up, and what was agreed
// to, and when, is written onto the new user's metadata. Signing in to an
// existing account asks nothing: the consent was given when it was created.

// Bump when the consent wording, Terms or Privacy Policy change materially, so
// it is clear which version an account agreed to.
export const CONSENT_VERSION = '2026-11-11';

export const CONSENT_TEXT =
  "I'm 18 or older and I agree to the Terms and Privacy Policy. "
  + 'I understand Kevi will process my content, which can include health-related information.';

export function canCreateAccount({ consent, loading = false } = {}) {
  return consent === true && !loading;
}

export function consentMetadata(now = new Date()) {
  return {
    consent_version: CONSENT_VERSION,
    consent_at: now.toISOString(),
    age_confirmed_18: true,
    health_data_consent: true,
  };
}
