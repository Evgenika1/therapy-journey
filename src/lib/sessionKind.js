// Therapy or coaching: which kind of session a row is.
//
// Pure functions plus one storage seam. The default matters more than anything
// else here: every session written before migration 023 has no kind, and all of
// them were therapy, so "missing" and "unknown" both mean therapy — in code as
// well as in the column default, because the app must keep working on a
// database that has not run the migration yet.

export const SESSION_KINDS = ['therapy', 'coaching'];
export const DEFAULT_KIND = 'therapy';
export const KIND_LABELS = { therapy: 'Therapy', coaching: 'Coaching' };

export function normalizeKind(value) {
  return SESSION_KINDS.includes(value) ? value : DEFAULT_KIND;
}

export const kindOf = (row) => normalizeKind(row?.kind);

// The Dashboard switch remembers the last choice so someone who only sees a
// coach picks it once. Storage can be missing (server render), blocked (private
// mode) or hold anything, and none of that may stop a recording.
const STORAGE_KEY = 'miru.sessionKind';
const defaultStorage = () => (typeof localStorage === 'undefined' ? undefined : localStorage);

export function readLastKind(storage = defaultStorage()) {
  try { return normalizeKind(storage?.getItem(STORAGE_KEY)); } catch { return DEFAULT_KIND; }
}

export function rememberKind(kind, storage = defaultStorage()) {
  const k = normalizeKind(kind);
  try { storage?.setItem(STORAGE_KEY, k); } catch { /* a lost preference is not an error */ }
  return k;
}
