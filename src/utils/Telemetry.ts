/**
 * Frame-time / FPS telemetry. PURE — no DOM, no three. A small ring buffer of
 * frame durations gives a rolling average so a framerate drop is never a black
 * box. The render loop pushes raw frame times; the debug overlay reads the
 * derived stats. Pool counts live on the game state itself (road/traffic
 * spawned/recycled/culled) and are read directly there.
 */

export class Telemetry {
  private readonly samples: Float64Array;
  private cursor = 0;
  private filled = 0;
  /** Most recent raw frame time in milliseconds. */
  lastMs = 0;

  constructor(window = 60) {
    this.samples = new Float64Array(window);
  }

  /** Record one frame duration (milliseconds). Allocates nothing. */
  push(ms: number): void {
    this.lastMs = ms;
    this.samples[this.cursor] = ms;
    this.cursor = (this.cursor + 1) % this.samples.length;
    if (this.filled < this.samples.length) this.filled++;
  }

  /** Rolling average frame time in milliseconds (0 before any samples). */
  get avgMs(): number {
    if (this.filled === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.filled; i++) sum += this.samples[i];
    return sum / this.filled;
  }

  /** Rolling average FPS (0 before any samples). */
  get fps(): number {
    const avg = this.avgMs;
    return avg > 0 ? 1000 / avg : 0;
  }
}
