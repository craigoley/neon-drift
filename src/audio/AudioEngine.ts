/**
 * Synthesized audio via the Web Audio API. NO audio files — every sound is
 * generated from oscillators and filters at runtime.
 *
 * The AudioContext is created lazily on first user gesture (browsers block
 * autoplay), so importing this module has no side effects and is Node-safe.
 */

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;

  /**
   * Create/resume the AudioContext. Must be called from a user-gesture handler
   * (click, keydown, touch) to satisfy browser autoplay policy.
   */
  async resume(): Promise<void> {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  /** Start a low synth drone standing in for the engine. */
  startEngine(): void {
    if (!this.ctx || this.engineOsc) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    gain.gain.value = 0.04;
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();

    this.engineOsc = osc;
    this.engineGain = gain;
  }

  /** Map normalised speed (0..1) to engine pitch so the drone rises with speed. */
  setEngineIntensity(normalizedSpeed: number): void {
    if (!this.ctx || !this.engineOsc) return;
    const base = 55;
    const top = 165;
    this.engineOsc.frequency.setTargetAtTime(
      base + (top - base) * normalizedSpeed,
      this.ctx.currentTime,
      0.1,
    );
  }

  /** Stop and release the engine drone. */
  stopEngine(): void {
    this.engineOsc?.stop();
    this.engineOsc?.disconnect();
    this.engineGain?.disconnect();
    this.engineOsc = null;
    this.engineGain = null;
  }
}
