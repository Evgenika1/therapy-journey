// How much of a subscription payment goes back when someone asks for a refund.
// Pure: the admin route fetches, this decides. Mirrors section "Refunds and the
// right of withdrawal" in the Terms.
//
//   Within 14 days of the payment (the EU right of withdrawal): the unused part
//   comes back, in proportion to the plan's minutes still unused. The person
//   asked for the service to start at once when they paid (Checkout's consent
//   box), so what they already used is theirs to pay for.
//   After 14 days: nothing; the plan runs to the end of the period.
//   Our fault (a transcription or analysis that failed): everything, any time.

export const WITHDRAWAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export function refundQuote({ paidCents, refundedCents = 0, planMinutes, usedMinutes, paidAt, now = new Date(), ourFault = false }) {
  const paid = Math.max(0, Math.round(Number(paidCents) || 0));
  // What has already gone back is taken off, so asking twice never pays twice.
  const already = Math.max(0, Math.round(Number(refundedCents) || 0));
  const paidTime = new Date(paidAt).getTime();
  const days = Number.isFinite(paidTime) ? Math.floor((now.getTime() - paidTime) / DAY_MS) : Infinity;
  // The period ends with the 14th calendar day after the payment (UTC), not 14
  // times 24 hours from the minute it was made.
  const paidDay = Number.isFinite(paidTime) ? Math.floor(paidTime / DAY_MS) * DAY_MS : NaN;
  const deadline = paidDay + (WITHDRAWAL_DAYS + 1) * DAY_MS;
  const withinWithdrawal = Number.isFinite(deadline) && now.getTime() >= paidTime && now.getTime() < deadline;
  const used = Math.max(0, Number(usedMinutes) || 0);
  const total = Number(planMinutes) > 0 ? Number(planMinutes) : 0;
  const unusedFraction = total > 0 ? Math.max(0, Math.min(1, (total - used) / total)) : 0;

  let amountCents = 0, reason = 'outside_withdrawal';
  if (ourFault) { amountCents = paid; reason = 'our_fault'; }
  else if (withinWithdrawal) { amountCents = Math.floor(paid * unusedFraction); reason = 'withdrawal'; }

  amountCents = Math.max(0, amountCents - already);
  return { amountCents, paidCents: paid, refundedCents: already, days, withinWithdrawal, unusedFraction, usedMinutes: used, planMinutes: total, reason };
}
