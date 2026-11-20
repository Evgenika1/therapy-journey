// Whether the page is in the middle of something a reload would interrupt
// (recording, transcribing, uploading). Pages set it; the update banner reads
// it and stays out of the way until the work is done. Module-level on purpose:
// one tab, one flag, no provider to thread through the layout.

let busy = false;
const listeners = new Set();

export function setBusy(value) {
  const next = Boolean(value);
  if (next === busy) return;
  busy = next;
  for (const l of listeners) l();
}

export function isBusy() {
  return busy;
}

export function subscribeBusy(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
