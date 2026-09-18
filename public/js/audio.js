// The Finch buzzer through WebAudio. main.js calls setTone(freq | null) every frame; the tone
// follows the robot's buzzer state so Pause and Stop silence it and Resume restarts it.

export function createAudio() {
  let ctx = null;
  let osc = null;
  let gain = null;
  let current = null;
  let muted = false;

  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  function stopTone() {
    if (osc) {
      try {
        gain.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
        osc.stop(ctx.currentTime + 0.05);
      } catch {
        /* ignore */
      }
      osc = null;
      gain = null;
    }
    current = null;
  }

  function setTone(freq) {
    const want = muted ? null : freq;
    if (want === current) return;
    stopTone();
    if (!want) return;
    const c = ensureContext();
    if (!c) return;
    osc = c.createOscillator();
    gain = c.createGain();
    osc.type = 'square';
    osc.frequency.value = want;
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.06, c.currentTime, 0.01);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    current = want;
  }

  return {
    setTone,
    setMuted(m) {
      muted = !!m;
      if (muted) stopTone();
    },
    get muted() {
      return muted;
    },
    /** Call from a user gesture so the browser lets audio play. */
    unlock() {
      ensureContext();
    },
  };
}

export const midiToFreq = (n) => 440 * Math.pow(2, (n - 69) / 12);
