// @ts-nocheck — diagnostic-only (diag branch), keeps tsc/build green.
/**
 * DIAGNOSTIC (diag/zen-contact-dead, NOT for merge) — "props don't slow the car" funnel.
 * The pure logic tests PASS and the wiring is intact, so this measures the LIVE path:
 * drive the car through the real seeded world (mirroring ZenScenery's field exactly) and
 * count how OFTEN contact actually fires, how CLOSE the car gets to props, and whether a
 * deliberate aim-at-a-prop run registers contact. Writes /tmp/zen_contact_diag.log.
 * Run: npx vitest run src/zen/__tests__/diag_zen_contact.test.ts
 */
import { describe, it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { ZEN, SCENERY } from '../../utils/constants';
import { ZenChunkField, chunkProps, propContactIntensity } from '../ZenWorld';
import { createZenVehicle, updateZen } from '../ZenVehicle';

const OUT = '/tmp/zen_contact_diag.log';
writeFileSync(OUT, '');
const log = (...a) =>
  appendFileSync(OUT, '[DIAG] ' + a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ') + '\n');

const KINDS = SCENERY.layers.length;
const TICK = 1 / 60;

/** Nearest prop distance to (x,z) across the active field (brute force, for context). */
function nearestPropDist(field, x, z) {
  let best = Infinity;
  field.forEachProp((p) => {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < best) best = d;
  });
  return best;
}

describe('DIAG: Zen contact — does the live check ever fire while driving?', () => {
  it('reach-per-kind (how small is the contact target?)', () => {
    log('contactCarRadius=', ZEN.contactCarRadius, 'propScale=[', ZEN.propScaleMin, ',', ZEN.propScaleMax, ']');
    SCENERY.layers.forEach((l, i) => {
      const rMin = (l.width / 2) * ZEN.propScaleMin + ZEN.contactCarRadius;
      const rMax = (l.width / 2) * ZEN.propScaleMax + ZEN.contactCarRadius;
      log(`kind ${i} (${l.kind}) width=${l.width} -> contact reach ${rMin.toFixed(2)}..${rMax.toFixed(2)}u from center`);
    });
  });

  it('A — straight drive forward ~30s: how many frames register contact?', () => {
    const field = new ZenChunkField(ZEN.worldSeed, ZEN.chunkRadius, KINDS);
    const v = createZenVehicle();
    let hitFrames = 0, minNearest = Infinity, maxContact = 0;
    const frames = 1800;
    for (let i = 0; i < frames; i++) {
      field.update(v.x, v.z);                 // mirror ZenScenery.update
      const c = field.contactAt(v.x, v.z);    // mirror renderer.contactAt
      if (c > 0) { hitFrames++; maxContact = Math.max(maxContact, c); }
      minNearest = Math.min(minNearest, nearestPropDist(field, v.x, v.z));
      updateZen(v, 0, 1, TICK);               // full throttle, straight
    }
    log(`A straight: ${hitFrames}/${frames} frames had contact>0 | maxContact=${maxContact.toFixed(3)} | ` +
      `closest the car EVER got to any prop = ${minNearest.toFixed(2)}u | ended at (${v.x.toFixed(1)},${v.z.toFixed(1)})`);
  });

  it('B — gentle wandering drive ~60s (steer sin): contact frames?', () => {
    const field = new ZenChunkField(ZEN.worldSeed, ZEN.chunkRadius, KINDS);
    const v = createZenVehicle();
    let hitFrames = 0; const frames = 3600;
    for (let i = 0; i < frames; i++) {
      field.update(v.x, v.z);
      if (field.contactAt(v.x, v.z) > 0) hitFrames++;
      updateZen(v, Math.sin(i * 0.013), 1, TICK); // lazy S-curves
    }
    log(`B wander: ${hitFrames}/${frames} frames had contact>0 | ended (${v.x.toFixed(1)},${v.z.toFixed(1)})`);
  });

  it('C — DELIBERATELY aim at the nearest prop: does the live path fire AT ALL?', () => {
    const field = new ZenChunkField(ZEN.worldSeed, ZEN.chunkRadius, KINDS);
    field.update(0, 0);
    // Find the nearest prop to spawn.
    let target = null, best = Infinity;
    field.forEachProp((p) => {
      const d = Math.hypot(p.x, p.z);
      if (d < best) { best = d; target = p; }
    });
    log(`C nearest prop to spawn: kind ${target.kind} at (${target.x.toFixed(1)},${target.z.toFixed(1)}), dist ${best.toFixed(1)}u`);
    // Teleport-drive straight onto it: sample contact AT the prop center + a sweep across it.
    const onCenter = field.contactAt(target.x, target.z);
    log(`C contactAt(prop center) = ${onCenter.toFixed(3)} (should be ~1.0 if the live path works)`);
    // Sweep the car across the prop center along x, logging where contact is felt.
    const reach = (SCENERY.layers[target.kind].width / 2) * target.scale + ZEN.contactCarRadius;
    let firstHit = null, lastHit = null;
    for (let d = -reach * 1.5; d <= reach * 1.5; d += 0.25) {
      const c = field.contactAt(target.x + d, target.z);
      if (c > 0) { if (firstHit === null) firstHit = d; lastHit = d; }
    }
    log(`C sweep across prop: contact felt over x-offset [${firstHit?.toFixed(2)}, ${lastHit?.toFixed(2)}]u ` +
      `(total width ${firstHit !== null ? (lastHit - firstHit).toFixed(2) : 'NONE'}u) | reach=${reach.toFixed(2)}u`);
  });

  it('E — FEED contact into updateZen: is the applied slowdown perceptible?', () => {
    const field = new ZenChunkField(ZEN.worldSeed, ZEN.chunkRadius, KINDS);
    const v = createZenVehicle();
    let bumps = 0, maxDip = 0, totalDip = 0;
    const frames = 3600;
    for (let i = 0; i < frames; i++) {
      field.update(v.x, v.z);
      const c = field.contactAt(v.x, v.z);
      const before = v.speed;
      updateZen(v, Math.sin(i * 0.013), 1, TICK, 0, c); // feed contact back (live behaviour)
      if (c > 0) {
        const dip = before - v.speed; // speed lost this frame to contact (+throttle/friction)
        if (dip > 0) { bumps++; maxDip = Math.max(maxDip, dip); totalDip += dip; }
        if (c > 0.5) log(`  contact frame ${i}: c=${c.toFixed(2)} speed ${before.toFixed(1)}->${v.speed.toFixed(1)} (dip ${dip.toFixed(2)}u/s)`);
      }
    }
    log(`E with contact fed back: ${bumps} frames lost speed to contact | maxDip=${maxDip.toFixed(2)}u/s/frame | ` +
      `cruise≈${v.speed.toFixed(0)} | a single bump removes a few u/s for 1-3 frames then throttle recovers`);
  });

  it('D — prop density: how spread out are the targets?', () => {
    // Active window props + mean nearest-neighbour spacing (why straight drives miss).
    const field = new ZenChunkField(ZEN.worldSeed, ZEN.chunkRadius, KINDS);
    field.update(0, 0);
    const props = [];
    field.forEachProp((p) => props.push(p));
    let sumNN = 0;
    for (const a of props) {
      let nn = Infinity;
      for (const b of props) if (b !== a) nn = Math.min(nn, Math.hypot(a.x - b.x, a.z - b.z));
      sumNN += nn;
    }
    const windowU = (2 * ZEN.chunkRadius + 1) * ZEN.chunkSize;
    log(`D active props=${props.length} over ${windowU}x${windowU}u window | mean nearest-neighbour spacing=${(sumNN / props.length).toFixed(1)}u`);
  });
});
