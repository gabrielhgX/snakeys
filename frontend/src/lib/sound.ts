// Synthetic sound effects — Web Audio API only, zero file dependencies.
// All sounds are procedurally generated so the bundle stays lean and there
// are no CDN / CORS issues in development.

/**
 * Plays a satisfying ascending arpeggio when a skin is equipped.
 * Three notes staggered 40ms apart: 440 → 554 → 659 Hz (A4–C#5–E5, A-major).
 * Each note is a sine wave with a quick attack and smooth decay (~220ms).
 */
export function playEquipSound(): void {
  try {
    // AudioContext must be created inside a user-gesture handler.
    // This function should only be called on button click — which qualifies.
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);

    const freqs = [440, 554, 659]; // A4, C#5, E5 — A-major triad

    freqs.forEach((freq, i) => {
      const delay = i * 0.045; // 45ms stagger per note
      const start = ctx.currentTime + delay;
      const end   = start + 0.22;

      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.value = freq;

      // Envelope: instant attack, smooth exponential release
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(1.0,   start + 0.008); // ~8ms attack
      gain.gain.exponentialRampToValueAtTime(0.001, end);       // decay to silence

      osc.connect(gain);
      gain.connect(master);

      osc.start(start);
      osc.stop(end);
    });

    // Close the context shortly after the last note ends to free resources.
    setTimeout(() => ctx.close(), 700);
  } catch {
    // AudioContext unavailable (e.g., headless test env) — silent no-op.
  }
}

/**
 * Short negative "thunk" for error feedback (equip failed).
 * Single descending tone: 330 → 220 Hz.
 */
export function playErrorSound(): void {
  try {
    const ctx  = new AudioContext();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(330, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.18);

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);

    setTimeout(() => ctx.close(), 600);
  } catch {
    // no-op
  }
}
