// One recording from several audio sources: the call's tab (the other person)
// and the microphone (you). In an online session with headphones, neither
// source alone has both voices: the mic never hears the headphones, and a
// browser call does not play your own voice back into its tab.
//
// The sources are mixed in a Web Audio graph into one MediaStream that
// MediaRecorder records like any other. stop() ends every source track and
// closes the graph; the caller still stops the mixed stream's own track.

export function mixAudioStreams(streams) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const out = ctx.createMediaStreamDestination();
  const nodes = [];
  for (const s of streams) {
    if (!s || s.getAudioTracks().length === 0) continue;
    const src = ctx.createMediaStreamSource(s);
    src.connect(out);
    nodes.push(src);
  }
  // A context created outside a click can start suspended; the recording would
  // then be silent. Resume it; harmless if it is already running.
  ctx.resume?.().catch(() => {});

  return {
    stream: out.stream,
    sourceTracks: streams.flatMap(s => (s ? s.getAudioTracks() : [])),
    stop() {
      for (const n of nodes) { try { n.disconnect(); } catch {} }
      for (const s of streams) s?.getTracks().forEach(t => t.stop());
      ctx.close?.().catch(() => {});
    },
  };
}
