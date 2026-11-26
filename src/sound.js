

// --- SOUNDS (werden live im Browser erzeugt – keine Dateien nötig) ---
export const Sound = (() => {
  let ctx = null;
  const get = () => {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    } catch (e) { return null; }
  };
  const tone = (freq, start, dur, type = 'sine', vol = 0.2) => {
    const c = get();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    const t = c.currentTime + start;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  };
  return {
    unlock: () => get(),
    tick: () => tone(1100, 0, 0.07, 'square', 0.06),
    timeUp: () => { tone(330, 0, 0.25, 'sawtooth', 0.12); tone(220, 0.22, 0.5, 'sawtooth', 0.12); },
    pop: () => { tone(520, 0, 0.12, 'triangle', 0.18); tone(780, 0.08, 0.15, 'triangle', 0.14); },
    reveal: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.3, 'triangle', 0.18)),
    buzzer: () => { tone(140, 0, 0.6, 'sawtooth', 0.22); tone(147, 0, 0.6, 'square', 0.1); },
    swoosh: () => [300, 450, 600, 800].forEach((f, i) => tone(f, i * 0.05, 0.12, 'sine', 0.08)),
    fanfare: (big = false) => {
      const notes = big ? [523, 659, 784, 1047, 784, 1047, 1319] : [392, 523, 659, 784];
      notes.forEach((f, i) => tone(f, i * (big ? 0.13 : 0.11), big && i === notes.length - 1 ? 0.9 : 0.25, 'triangle', 0.2));
    },
  };
})();
