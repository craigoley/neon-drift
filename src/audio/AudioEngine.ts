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

  get started(): boolean {
    return this.ctx !== null;
  }

  /**
   * Create/resume the context and start the persistent engine drone. Must be
   * called from a user-gesture handler (keydown / pointerdown / touchstart).
   */
  async resume(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = AUDIO.masterGain;
      this.master.connect(this.ctx.destination);
      this.noiseBuffer = this.makeNoiseBuffer();
      this.startEngine();
      this.startScreech();
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  private makeNoiseBuffer(): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
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
    filter.frequency.value = 800;

    this.engineOscA = ctx.createOscillator();
    this.engineOscB = ctx.createOscillator();
    this.engineOscA.type = 'sawtooth';
    this.engineOscB.type = 'sawtooth';
    this.engineOscA.frequency.value = AUDIO.engineBaseHz;
    this.engineOscB.frequency.value = AUDIO.engineBaseHz * 1.01; // slight detune
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
    band.frequency.value = 2200;
    band.Q.value = 2;
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
    this.engineOscA.frequency.setTargetAtTime(hz, t, 0.08);
    this.engineOscB.frequency.setTargetAtTime(hz * 1.01, t, 0.08);
  }

  /** Turn tyre screech on/off (handbrake while moving). */
  setScreech(active: boolean): void {
    if (!this.ctx || !this.screechGain) return;
    const t = this.ctx.currentTime;
    this.screechGain.gain.setTargetAtTime(active ? AUDIO.screechGain : 0, t, 0.05);
  }

  /** Near-miss: a short upward whoosh plus a bright combo-tick blip. */
  playNearMiss(): void {
    if (!this.ctx || !this.noiseBuffer || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const whooshGain = ctx.createGain();
    whooshGain.gain.setValueAtTime(0, t);
    whooshGain.gain.linearRampToValueAtTime(AUDIO.whooshGain, t + 0.04);
    whooshGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(AUDIO.whooshHz, t);
    band.frequency.exponentialRampToValueAtTime(AUDIO.whooshHz * 2.5, t + 0.3);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.connect(band).connect(whooshGain).connect(this.master);
    src.start(t);
    src.stop(t + 0.32);

    this.blip(AUDIO.comboBlipHz, 0.12);
  }

  /** Crash: white-noise burst plus a low sine thump. */
  playCrash(): void {
    if (!this.ctx || !this.noiseBuffer || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(AUDIO.crashNoiseGain, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.connect(noiseGain).connect(this.master);
    src.start(t);
    src.stop(t + 0.42);

    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(AUDIO.crashThumpHz * 2, t);
    thump.frequency.exponentialRampToValueAtTime(AUDIO.crashThumpHz, t + 0.5);
    thumpGain.gain.setValueAtTime(0.6, t);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    thump.connect(thumpGain).connect(this.master);
    thump.start(t);
    thump.stop(t + 0.62);
  }

  private blip(hz: number, gain: number): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = hz;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.14);
  }
}
