import { describe, expect, it } from 'vitest';
import { Telemetry } from '../../utils/Telemetry';

describe('Telemetry — rolling average', () => {
  it('reports 0 before any samples', () => {
    const t = new Telemetry(10);
    expect(t.avgMs).toBe(0);
    expect(t.fps).toBe(0);
  });

  it('averages frame times and derives FPS', () => {
    const t = new Telemetry(10);
    for (let i = 0; i < 5; i++) t.push(16.6667);
    expect(t.avgMs).toBeCloseTo(16.6667);
    expect(t.fps).toBeCloseTo(60, 0);
  });

  it('window is bounded — old samples roll off', () => {
    const t = new Telemetry(3);
    t.push(100);
    t.push(10);
    t.push(10);
    t.push(10); // evicts the 100
    expect(t.avgMs).toBeCloseTo(10);
  });
});
