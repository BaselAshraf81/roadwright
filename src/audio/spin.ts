/**
 * Cartoon spin whistle.
 *
 * On an irregular wheel the angular velocity is not constant. Rolling without
 * slipping gives d(theta)/dx = 1 / r, so omega = v / r, and wherever the outline
 * dips close to the hub the wheel whips round fast. That is a real measured
 * quantity, not an effect, which is why it earns a sound.
 *
 * The pitch and length are both derived from the measured spin ratio, so a sharper
 * whip genuinely sounds sharper. Nothing here is decorative.
 *
 * Off by default. The product was chosen because its payoff survives with the sound
 * muted, sound is never the only channel for anything, and audio may not start
 * without an explicit gesture.
 */

export interface SpinVoice {
  /** Play one whip. `intensity` is 0 to 1, already normalised by the caller. */
  readonly play: (intensity: number) => void;
  readonly close: () => void;
}

type Ctor = typeof AudioContext;

function audioContextCtor(): Ctor | null {
  const w = window as unknown as {
    AudioContext?: Ctor;
    webkitAudioContext?: Ctor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export function isSupported(): boolean {
  return audioContextCtor() !== null;
}

/**
 * Create the voice. Must be called from a user gesture, or the context starts
 * suspended and stays that way.
 */
export function createSpinVoice(): SpinVoice | null {
  const Ctx = audioContextCtor();
  if (!Ctx) return null;

  const ctx = new Ctx();

  // One shared output stage, so overlapping whips cannot stack into clipping.
  const master = ctx.createGain();
  master.gain.value = 0.9;

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;

  // Slide whistles are breathy rather than pure, and a gentle top end keeps the
  // sweep from turning into a piercing beep at the high extreme.
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 4200;
  tone.Q.value = 0.4;

  master.connect(tone);
  tone.connect(limiter);
  limiter.connect(ctx.destination);

  const play = (intensity: number): void => {
    if (ctx.state === "suspended") void ctx.resume();

    const k = Math.max(0, Math.min(1, intensity));
    const now = ctx.currentTime;

    // A harder whip is shorter, higher, and louder.
    const duration = 0.085 + (1 - k) * 0.075;
    const startHz = 520 + k * 260;
    const peakHz = 1500 + k * 1500;
    const endHz = peakHz * 0.72;
    const peakGain = 0.06 + k * 0.1;

    const osc = ctx.createOscillator();
    osc.type = "sine";

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + duration * 0.22);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    // Rise fast, then tip over. That shape is what reads as a cartoon zip rather
    // than a synthesiser sweep.
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(peakHz, now + duration * 0.66);
    osc.frequency.exponentialRampToValueAtTime(endHz, now + duration);

    // A touch of vibrato, which is what a real slide whistle does in a hand.
    const wobble = ctx.createOscillator();
    wobble.type = "sine";
    wobble.frequency.value = 34;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 22 * k;
    wobble.connect(wobbleDepth);
    wobbleDepth.connect(osc.frequency);

    osc.connect(gain);
    gain.connect(master);

    osc.start(now);
    wobble.start(now);
    osc.stop(now + duration + 0.02);
    wobble.stop(now + duration + 0.02);

    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
      wobble.disconnect();
      wobbleDepth.disconnect();
    };
  };

  return {
    play,
    close: () => {
      void ctx.close();
    },
  };
}

/**
 * Rising-edge detector for the spin ratio, with a cooldown.
 *
 * A wheel crosses the threshold once per fast corner, but a bare comparison would
 * retrigger every frame it stays above. This fires on the way up only, then holds
 * off until the ratio has fallen back below the release level.
 */
export class SpinTrigger {
  private armed = true;
  private lastFired = -Infinity;

  constructor(
    private readonly threshold = 2.1,
    /** Must fall to this before the trigger re-arms, which stops chatter. */
    private readonly release = 1.7,
    private readonly cooldownSeconds = 0.14,
  ) {}

  /**
   * Feed the current spin ratio and wall-clock seconds. Returns an intensity in
   * 0 to 1 when a whip should sound, or null.
   */
  update(ratio: number, nowSeconds: number): number | null {
    if (ratio < this.release) this.armed = true;

    if (
      this.armed &&
      ratio >= this.threshold &&
      nowSeconds - this.lastFired >= this.cooldownSeconds
    ) {
      this.armed = false;
      this.lastFired = nowSeconds;
      // Map the overshoot onto 0 to 1, saturating at roughly a 6x spin.
      const over = (ratio - this.threshold) / (6 - this.threshold);
      return Math.max(0, Math.min(1, over));
    }
    return null;
  }

  reset(): void {
    this.armed = true;
    this.lastFired = -Infinity;
  }
}
