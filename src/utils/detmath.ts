/**
 * DETERMINISTIC math (MP fix PR-B) — bit-identical across JS engines.
 *
 * The cross-engine 2P desync came from `Math.sin/exp/pow`: ECMAScript leaves those
 * implementation-approximated, so V8 (Chrome) and JavaScriptCore (Safari) return
 * sub-ULP-different results → a float-gated spawn/collision flips one frame apart →
 * the lockstep sims diverge. These replacements use ONLY IEEE-754-mandated ops
 * (+ − × ÷, `Math.abs/round/floor`, comparisons), which are correctly-rounded and
 * IDENTICAL across conforming engines — so the sim becomes bit-identical cross-engine.
 *
 * THE TRAP these avoid: the tables/coefficients are baked LITERALS (or derived from
 * basic ops). Nothing here calls `Math.sin/exp/pow` at load time — doing so would bake
 * an engine-specific value and reintroduce the divergence.
 *
 * Accuracy is "good enough + CONSISTENT" (both peers run the same approximation, so
 * consistency matters, not matching the old Math.* exactly). The values intentionally
 * differ slightly from Math.* — the sim math is versioned (see SIM_MATH_VERSION).
 */

const TWO_PI = 6.283185307179586;
const SIN_B = 1.2732395447351628; // 4/π
const SIN_C = -0.4052847345693511; // −4/π²
const LOG2E = 1.4426950408889634; // 1/ln2
const E = 2.718281828459045;

/**
 * Deterministic sine, ~0.18% max error. Range-reduce to [−π, π] with `Math.round`
 * (exactly specified → deterministic), then the "Nick/Bhaskara" parabola + one
 * refinement pass — all basic ops.
 */
export function detSin(x: number): number {
  const r = x - Math.round(x / TWO_PI) * TWO_PI; // → [−π, π]
  let y = SIN_B * r + SIN_C * r * Math.abs(r);
  y = 0.225 * (y * Math.abs(y) - y) + y;
  return y;
}

/** Deterministic log2(x) for x>0: normalize the exponent (×0.5/×2 are EXACT — no
 *  rounding), then an atanh series on the [1,2) mantissa. */
function detLog2(x: number): number {
  let e = 0;
  while (x >= 2) {
    x *= 0.5;
    e++;
  }
  while (x < 1) {
    x *= 2;
    e--;
  }
  const t = (x - 1) / (x + 1); // x∈[1,2) ⇒ t∈[0, 1/3]
  const t2 = t * t;
  const series = t * (1 + t2 * (1 / 3 + t2 * (1 / 5 + t2 * (1 / 7))));
  return e + 2 * LOG2E * series; // ln(x)=2·atanh(t); log2 = ln/ln2
}

/** Deterministic 2^y: split into integer (exact ×2/×0.5 scaling) + a minimax poly
 *  for the [0,1) fraction. */
function detExp2(y: number): number {
  // Bound the integer scaling: below 2^-1075 a double underflows to 0, above 2^1024
  // it overflows to Infinity. This also caps the scaling loop (no runaway for huge
  // |y|, e.g. exp of a billion-unit distance). Both limits are deterministic.
  if (y <= -1075) return 0;
  if (y >= 1024) return Infinity;
  const i = Math.floor(y);
  const f = y - i; // [0, 1)
  const p =
    1 +
    f * (0.6931471805599453 + f * (0.2402265069591007 + f * (0.0555041086648216 + f * (0.0096181291076286 + f * 0.0013333558146429))));
  let scale = 1;
  if (i >= 0) for (let k = 0; k < i; k++) scale *= 2;
  else for (let k = 0; k < -i; k++) scale *= 0.5;
  return p * scale;
}

/** Deterministic base^exp (base>0) via 2^(exp·log2(base)). */
export function detPow(base: number, exp: number): number {
  if (base <= 0) return 0;
  return detExp2(exp * detLog2(base));
}

/** Deterministic e^x. */
export function detExp(x: number): number {
  return detPow(E, x);
}
