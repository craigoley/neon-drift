/**
 * Synthesized audio via the Web Audio API. NO audio files — every sound is
 * generated from oscillators, filtered noise and envelopes at runtime.
 *
 * The AudioContext is created lazily on the first user gesture (browsers block
 * autoplay), so importing this module has no side effects and is Node-safe.
 * No three imports.
 */

import { AUDIO } from '../utils/constants';

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // Engine drone.
  private engineOscA: OscillatorNode | null = null;
  private engineOscB: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;

  // Tyre screech (filtered noise, gated by handbrake).
  private screechSource: AudioBufferSourceNode | null = null;
  private screechGain: GainNode | null = null;

  /** Master mute state (the sound on/off setting). Remembered before the
   *  context exists so it can be applied the moment it's unlocked. */
  private enabled = true;
  /** Transient mute (e.g. while the game is paused / backgrounded), kept
   *  separate from the user's `enabled` setting so resuming restores it. */
  private muted = false;

  get started(): boolean {
    return this.ctx !== null;
  }

  /**
   * Sound on/off. Mutes/unmutes the master bus immediately (no restart needed):
   * the engine drone keeps running silently when off, so toggling back on is
   * instant. Remembered even before the context is unlocked.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.applyMasterGain();
  }

  /** Transient mute, independent of the user's sound setting — used to silence
   *  audio while paused / backgrounded. Restored (to the user's setting) on
   *  unmute. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
  }

  /** Effective master gain = on only when sound is enabled AND not transiently muted. */
  private applyMasterGain(): void {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        this.enabled && !this.muted ? AUDIO.masterGain : 0,
        this.ctx.currentTime,
        AUDIO.muteRamp,
      );
    }
  }

  /**
   * Create/resume the context and start the persistent engine drone. Must be
   * called from a user-gesture handler (keydown / pointerdown / touchstart).
   */
  async resume(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      // Honour the persisted sound setting from the very first sample.
      this.master.gain.value = this.enabled && !this.muted ? AUDIO.masterGain : 0;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoiseBuffer();
      this.startEngine();
      this.startScreech();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  private makeNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * AUDIO.noiseBufferSeconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic-ish noise; randomness here is cosmetic, not gameplay.
    let seed = 22222;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x3fffffff) - 1;
    }
    return buffer;
  }

  private startEngine(): void {
    const ctx = this.ctx!;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = AUDIO.engineGain;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = AUDIO.engineLowpassHz;

    this.engineOscA = ctx.createOscillator();
    this.engineOscB = ctx.createOscillator();
    this.engineOscA.type = 'sawtooth';
    this.engineOscB.type = 'sawtooth';
    this.engineOscA.frequency.value = AUDIO.engineBaseHz;
    this.engineOscB.frequency.value = AUDIO.engineBaseHz * AUDIO.engineDetune;
    this.engineOscA.connect(filter);
    this.engineOscB.connect(filter);
    filter.connect(this.engineGain).connect(this.master!);
    this.engineOscA.start();
    this.engineOscB.start();
  }

  private startScreech(): void {
    const ctx = this.ctx!;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = AUDIO.screechBandHz;
    band.Q.value = AUDIO.screechQ;
    this.screechSource = ctx.createBufferSource();
    this.screechSource.buffer = this.noiseBuffer;
    this.screechSource.loop = true;
    this.screechSource.connect(band).connect(this.screechGain).connect(this.master!);
    this.screechSource.start();
  }

  /** Map normalised speed (0..1) to engine pitch. */
  setSpeed(normalized: number): void {
    if (!this.ctx || !this.engineOscA || !this.engineOscB) return;
    const hz = AUDIO.engineBaseHz + (AUDIO.engineTopHz - AUDIO.engineBaseHz) * normalized;
    const t = this.ctx.currentTime;
    this.engineOscA.frequency.setTargetAtTime(hz, t, AUDIO.enginePitchGlide);
    this.engineOscB.frequency.setTargetAtTime(hz * AUDIO.engineDetune, t, AUDIO.enginePitchGlide);
  }

  /** Turn tyre screech on/off (handbrake while moving). */
  setScreech(active: boolean): void {
    if (!this.ctx || !this.screechGain) return;
    const t = this.ctx.currentTime;
    this.screechGain.gain.setTargetAtTime(active ? AUDIO.screechGain : 0, t, AUDIO.screechRamp);
  }

  /** Near-miss: a short upward whoosh plus a bright combo-tick blip. */
  playNearMiss(): void {
    if (!this.ctx || !this.noiseBuffer || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const whooshGain = ctx.createGain();
    whooshGain.gain.setValueAtTime(0, t);
    whooshGain.gain.linearRampToValueAtTime(AUDIO.whooshGain, t + AUDIO.whooshAttack);
    whooshGain.gain.exponentialRampToValueAtTime(0.0001, t + AUDIO.whooshDecay);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(AUDIO.whooshHz, t);
    band.frequency.exponentialRampToValueAtTime(AUDIO.whooshHz * AUDIO.whooshSweep, t + AUDIO.whooshDecay);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.connect(band).connect(whooshGain).connect(this.master);
    src.start(t);
    src.stop(t + AUDIO.whooshStop);

    this.blip(AUDIO.comboBlipHz, AUDIO.comboBlipGain);
  }

  /** Crash: white-noise burst plus a low sine thump. */
  playCrash(): void {
    if (!this.ctx || !this.noiseBuffer || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(AUDIO.crashNoiseGain, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + AUDIO.crashNoiseDecay);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.connect(noiseGain).connect(this.master);
    src.start(t);
    src.stop(t + AUDIO.crashNoiseStop);

    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(AUDIO.crashThumpHz * AUDIO.crashThumpStartMul, t);
    thump.frequency.exponentialRampToValueAtTime(AUDIO.crashThumpHz, t + AUDIO.crashThumpGlide);
    thumpGain.gain.setValueAtTime(AUDIO.crashThumpGain, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + AUDIO.crashThumpDecay);
    thump.connect(thumpGain).connect(this.master);
    thump.start(t);
    thump.stop(t + AUDIO.crashThumpStop);
  }

  private blip(hz: number, gain: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = hz;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + AUDIO.comboBlipDecay);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + AUDIO.comboBlipStop);
  }
}
