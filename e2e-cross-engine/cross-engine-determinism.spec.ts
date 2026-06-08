/**
 * CROSS-ENGINE DETERMINISM HARNESS (MP fix PR-A) — the automated reproduction of the
 * confirmed 2P-race desync. It runs the SAME pure sim in TWO JS engines — chromium
 * (V8) and webkit (JavaScriptCore, Safari's engine) — on the real race configuration
 * (real seed, two real cars, mode=Classic, mpRace=true, thousands of frames through
 * spawns and crashes) and asserts the #89 world checksums are IDENTICAL.
 *
 * EXPECTED RED on this branch (pre-fix): V8 and JSC compute Math.sin/exp/pow slightly
 * differently, so a sub-ULP drift (e.g. speed ~1e-14) flips a float-gated spawn/
 * collision one frame apart → the sims diverge. The failure prints the FIRST diverging
 * frame + field + magnitude (#89 readout), proving it's float drift, not a logic bug.
 *
 * This becomes the GREEN gate that proves PR-B (de-float the transcendentals). It is
 * NON-BLOCKING: its own config/dir, not wired into the blocking lint/test/build/e2e
 * gates. Run it explicitly: `npm run e2e:cross-engine`.
 */
import { chromium, expect, test, webkit, type BrowserType } from '@playwright/test';
import { compareWorld, type WorldSum } from '../src/net/Desync';

interface ProbeConfig {
  seed: number;
  carA: string;
  carB: string;
  frames: number;
  sampleEvery: number;
}

// Several seeds + car pairings — the divergence is input-dependent, so one config
// might happen to agree; the spread exposes it. (Long enough to pass several spawns
// AND crashes — the crash slowdown is a known amplifier.)
const CONFIGS: ProbeConfig[] = [
  { seed: 0x5eed1234, carA: 'pulse', carB: 'nova', frames: 6000, sampleEvery: 30 },
  { seed: 1337, carA: 'ghost', carB: 'ember', frames: 6000, sampleEvery: 30 },
  { seed: 999983, carA: 'vapor', carB: 'onyx', frames: 6000, sampleEvery: 30 },
  { seed: 42, carA: 'slipstream', carB: 'pulse', frames: 6000, sampleEvery: 30 },
];

async function probeIn(bt: BrowserType, url: string, cfg: ProbeConfig): Promise<WorldSum[]> {
  const browser = await bt.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__determinismProbe === 'function', null, { timeout: 30_000 });
    return await page.evaluate((c) => window.__determinismProbe!(c), cfg);
  } finally {
    await browser.close();
  }
}

/** First frame where the two engines' checksums differ, with the #89 field breakdown. */
function firstDivergence(chr: WorldSum[], wk: WorldSum[]): string | null {
  const n = Math.min(chr.length, wk.length);
  for (let i = 0; i < n; i++) {
    const v = compareWorld(chr[i], wk[i]); // eps=0 → exact; reports the earliest field + magnitude
    if (!v.ok) return v.detail;
  }
  return null;
}

for (const cfg of CONFIGS) {
  test(`V8(chromium) ≡ JSC(webkit) — seed ${cfg.seed} · ${cfg.carA} vs ${cfg.carB}`, async ({ baseURL }) => {
    const url = `${baseURL}/probe.html`;
    const [chr, wk] = await Promise.all([probeIn(chromium, url, cfg), probeIn(webkit, url, cfg)]);

    expect(chr.length, 'probe produced samples').toBeGreaterThan(10);
    expect(chr.length, 'both engines sampled the same number of frames').toBe(wk.length);

    const diff = firstDivergence(chr, wk);
    if (diff) console.error(`[cross-engine] seed ${cfg.seed} ${cfg.carA}/${cfg.carB}: ${diff}`);
    // EXPECTED RED until PR-B de-floats the transcendentals. The message names the
    // first diverging frame + field + magnitude (a ~1e-14 float delta ⇒ cross-engine FP).
    expect(diff, diff ? `cross-engine DESYNC — ${diff}` : 'engines in sync').toBeNull();
  });
}
