import { describe, it, expect } from 'vitest';
import { computeRounding, WEEKLY_GOAL_MINUTES, HOUR_IN_MINUTES } from './rounding.js';

// ── helpers ────────────────────────────────────────────────────────────────
function raw(categoryId: number, minutes: number) {
  return { categoryId, minutes };
}

// ── computeRounding ────────────────────────────────────────────────────────

describe('computeRounding', () => {
  // ── no-op cases ──────────────────────────────────────────────────────────

  it('returns no-op for an empty category list', () => {
    const { result, weekWouldExceed, capped } = computeRounding([], 0);
    expect(result).toEqual([]);
    expect(weekWouldExceed).toBe(false);
    expect(capped).toBe(false);
  });

  it('returns no-op when all categories have 0 minutes', () => {
    const { result, weekWouldExceed, capped } = computeRounding(
      [raw(1, 0), raw(2, 0)],
      0
    );
    expect(result).toEqual([
      { categoryId: 1, rawMinutes: 0, roundedMinutes: 0 },
      { categoryId: 2, rawMinutes: 0, roundedMinutes: 0 },
    ]);
    expect(weekWouldExceed).toBe(false);
    expect(capped).toBe(false);
  });

  // ── basic ceiling rounding ───────────────────────────────────────────────

  it('rounds each category up to the nearest hour', () => {
    const { result, capped } = computeRounding(
      [raw(1, 61), raw(2, 120), raw(3, 1)],
      0
    );
    // 61 min → 120 min (ceil to next hour)
    // 120 min → 120 min (already whole hour)
    // 1 min → 60 min
    expect(result).toEqual([
      { categoryId: 1, rawMinutes: 61, roundedMinutes: 120 },
      { categoryId: 2, rawMinutes: 120, roundedMinutes: 120 },
      { categoryId: 3, rawMinutes: 1, roundedMinutes: 60 },
    ]);
    expect(capped).toBe(false);
  });

  it('leaves exactly-whole-hour categories unchanged', () => {
    const { result, capped } = computeRounding(
      [raw(1, 60), raw(2, 180), raw(3, 240)],
      0
    );
    expect(result.map((r) => r.roundedMinutes)).toEqual([60, 180, 240]);
    expect(capped).toBe(false);
  });

  // ── 40h weekly cap ───────────────────────────────────────────────────────

  it('does not cap when rounded total stays within the weekly goal', () => {
    // weekSoFar = 2160 (36h), day rounded = 120 (2h) → projected 2280 < 2400
    const { result, weekWouldExceed, capped } = computeRounding(
      [raw(1, 90)],
      2160
    );
    expect(result[0].roundedMinutes).toBe(120);
    expect(weekWouldExceed).toBe(false);
    expect(capped).toBe(false);
  });

  it('caps day total at remaining weekly headroom (single category)', () => {
    // weekSoFar = 2340 (39h), only 60 min headroom left
    // raw = 30 min → would round to 60 min, which exactly fits the 60-min headroom
    const { result, weekWouldExceed, capped } = computeRounding(
      [raw(1, 30)],
      2340
    );
    expect(result[0].rawMinutes).toBe(30);
    expect(result[0].roundedMinutes).toBe(60); // rounds to 60, fits in headroom
    expect(weekWouldExceed).toBe(false);
    expect(capped).toBe(false);
  });

  it('caps day total when rounding bonus exceeds headroom', () => {
    // weekSoFar = 2340 (39h), only 60 min headroom left
    // raw = 30 min → rounds to 60 normally, but here we need raw > headroom scenario
    // raw = 90 min → rounds to 120 min; headroom = 60 min; excess = 60 min
    // reducible = 120 - 90 = 30 min; can only remove 30, not 60
    // so roundedMinutes ends at 90 (back to raw), NOT at headroom of 60
    // (algorithm never reduces below raw minutes)
    const { result, weekWouldExceed, capped } = computeRounding(
      [raw(1, 90)],
      2340
    );
    expect(result[0].rawMinutes).toBe(90);
    expect(result[0].roundedMinutes).toBe(90); // rounding bonus fully removed, stops at raw
    expect(weekWouldExceed).toBe(true);
    expect(capped).toBe(true);
  });

  it('never rounds below raw minutes when capping', () => {
    // weekSoFar = 2400 (already at 40h), headroom = 0
    // raw = 50 min → rounds up to 60, but headroom is 0 → cap removes the 10-min bonus
    // After capping, roundedMinutes should be 50 (raw), not below
    const { result, capped } = computeRounding(
      [raw(1, 50)],
      2400
    );
    expect(result[0].roundedMinutes).toBe(50); // cannot go below raw
    expect(capped).toBe(true);
  });

  // ── multi-category capping (greedy: largest first) ───────────────────────

  it('removes excess from the largest-rounded category first (greedy by size)', () => {
    // weekSoFar = 2280 (38h), headroom = 120 min (2h)
    // cat A: 30 min → rounds to 60 min (+30 bonus)
    // cat B: 120 min → rounds to 120 min (already whole, +0 bonus)
    // cat C: 90 min → rounds to 120 min (+30 bonus)
    // day rounded total = 300 min → excess = 300 - 120 = 180 min
    // sorted by roundedMinutes desc: B(120), C(120), A(60)
    // B has 0 reducible (raw=120), C has 30 reducible (raw=90), A has 30 reducible (raw=30)
    // removed: 30 from C, 30 from A → total removed = 60; excess remains 120 (can't remove more)
    // final: A=30, B=120, C=90 (both bonus-stripped back to raw)
    const { result, capped } = computeRounding(
      [raw(1, 30), raw(2, 120), raw(3, 90)],
      2280
    );
    expect(result.find((r) => r.categoryId === 1)?.roundedMinutes).toBe(30); // bonus stripped
    expect(result.find((r) => r.categoryId === 2)?.roundedMinutes).toBe(120); // no bonus to strip
    expect(result.find((r) => r.categoryId === 3)?.roundedMinutes).toBe(90); // bonus stripped
    // No category goes below raw
    for (const r of result) {
      expect(r.roundedMinutes).toBeGreaterThanOrEqual(r.rawMinutes);
    }
    expect(capped).toBe(true);
  });

  it('removes excess from the largest category first when bonuses differ', () => {
    // weekSoFar = 2340 (39h), headroom = 60 min (1h)
    // cat A: 10 min → rounds to 60 min (+50 bonus — largest)
    // cat B: 50 min → rounds to 60 min (+10 bonus)
    // day rounded total = 120 min → excess = 60 min
    // sorted desc: A(60), B(60) — same rounded size; A processed first (stable sort by drizzle-sortable)
    // A has 50 reducible, B has 10; need 60 total → take 50 from A, 10 from B
    const { result, capped } = computeRounding(
      [raw(1, 10), raw(2, 50)],
      2340
    );
    const total = result.reduce((s, r) => s + r.roundedMinutes, 0);
    // total must equal exactly headroom (60) since enough bonus exists to cover excess
    expect(total).toBe(60);
    for (const r of result) {
      expect(r.roundedMinutes).toBeGreaterThanOrEqual(r.rawMinutes);
    }
    expect(capped).toBe(true);
  });

  it('preserves original array order in the result', () => {
    // Verify that the result is returned in the same order as the input,
    // even though the capping step sorts internally.
    const input = [raw(10, 70), raw(20, 130), raw(30, 50)];
    const { result } = computeRounding(input, 2220); // 37h so far, 3h headroom
    expect(result.map((r) => r.categoryId)).toEqual([10, 20, 30]);
  });

  // ── exact 40h boundary ───────────────────────────────────────────────────

  it('accepts exactly 40h week without capping', () => {
    // 2400 min of prior work, 0 min today → no adjustment needed
    const { result, capped } = computeRounding([raw(1, 0)], WEEKLY_GOAL_MINUTES);
    expect(result[0].roundedMinutes).toBe(0);
    expect(capped).toBe(false);
  });

  it('rounds 60-minute blocks to exactly one HOUR_IN_MINUTES', () => {
    const { result } = computeRounding([raw(1, HOUR_IN_MINUTES)], 0);
    expect(result[0].roundedMinutes).toBe(HOUR_IN_MINUTES);
  });

  // ── custom weeklyGoalMinutes parameter ───────────────────────────────────

  it('uses the default 2400 min goal when weeklyGoalMinutes is omitted', () => {
    // weekSoFar = 2340 (39h), raw = 90 min → rounds to 120, excess vs 2400 cap
    const { capped, weekWouldExceed } = computeRounding([raw(1, 90)], 2340);
    expect(capped).toBe(true);
    expect(weekWouldExceed).toBe(true);
  });

  it('respects a custom 20h goal (1200 min)', () => {
    // goal = 1200 min (20h); weekSoFar = 1140 (19h), raw = 90 → rounds to 120
    // headroom = 60 min; excess = 60 min; reducible = 30; stops at raw (90)
    const { result, capped, weekWouldExceed } = computeRounding([raw(1, 90)], 1140, 1200);
    expect(weekWouldExceed).toBe(true);
    expect(capped).toBe(true);
    expect(result[0].roundedMinutes).toBe(90); // rounding bonus stripped
  });

  it('does not cap when weekSoFar + rounded total equals the custom goal exactly', () => {
    // goal = 1200 min; weekSoFar = 1080 (18h), raw = 120 → rounds to 120 → projected = 1200
    const { result, capped } = computeRounding([raw(1, 120)], 1080, 1200);
    expect(result[0].roundedMinutes).toBe(120);
    expect(capped).toBe(false);
  });

  it('respects a goal of 0 — all rounding bonuses are removed', () => {
    // goal = 0; headroom = 0; raw = 30 min → rounds to 60 normally; bonus = 30 min removed
    const { result, capped } = computeRounding([raw(1, 30)], 0, 0);
    expect(result[0].roundedMinutes).toBe(30); // back to raw
    expect(capped).toBe(true);
  });
});
