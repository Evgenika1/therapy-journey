// The consent asked for before paying: start the plan now, and if the
// 14-day withdrawal right is used, pay for what was already used. Without it,
// EU law lets a customer who withdraws claim the whole payment back.
// Shown on the Billing page; the server refuses checkout without it and
// stores the version and time on the Stripe subscription as the record.

export const WITHDRAWAL_CONSENT_VERSION = '2026-11-21';

export const WITHDRAWAL_CONSENT_TEXT =
  'I ask Kevi to start my plan right away. I understand that I can cancel within 14 days, ' +
  'and that I then get back only the unused part of my payment.';

export function consentMetadata(now = new Date()) {
  return { withdrawal_consent: WITHDRAWAL_CONSENT_VERSION, withdrawal_consent_at: now.toISOString() };
}

// Printed on every invoice for this customer (Stripe invoice footer), so the
// confirmation of the purchase carries the consent, as the ACM asks: the
// request to start at once and its consequence, then the way to withdraw.
export const INVOICE_FOOTER =
  'You asked Kevi to start your plan right away. If you withdraw within 14 days of paying, ' +
  'you get back the part of your payment for the minutes you have not used. ' +
  'To withdraw, write to hi@kevi.online. Full terms: https://www.kevi.online/terms#refunds';
