// Runs before the page's own scripts (DESIGN D55). Replaces getUserMedia with a generated
// guitar-like tone, so the tuner can be tested without a real microphone.
//   window.__fakeMic.set({ freq: 110 })            change the note (Hz), live
//   window.__fakeMic.set({ gain: 0 })              silence
//   window.__fakeMic.set({ deny: true })           the next getUserMedia fails with NotAllowedError
(() => {
  const state = { freq: 110, gain: 0.3, partials: [1, 0.6, 0.4, 0.25, 0.15], deny: false };
  let ctx = null, voices = [];
  const tune = () => {
    voices.forEach(({ osc, amp }, i) => {
      osc.frequency.value = state.freq * (i + 1);
      amp.gain.value = state.gain * (state.partials[i] ?? 0);
    });
  };
  window.__fakeMic = {
    state,
    set(opts) { Object.assign(state, opts); tune(); },
  };
  if (!navigator.mediaDevices) return;
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (state.deny) throw new DOMException("Permission denied", "NotAllowedError");
    if (!constraints?.audio) throw new DOMException("only audio is faked", "NotSupportedError");
    ctx ||= new AudioContext();
    await ctx.resume().catch(() => {});
    const dest = ctx.createMediaStreamDestination();
    voices = state.partials.map(() => {
      const osc = ctx.createOscillator(), amp = ctx.createGain();
      osc.connect(amp).connect(dest);
      osc.start();
      return { osc, amp };
    });
    tune();
    return dest.stream;
  };
})();
