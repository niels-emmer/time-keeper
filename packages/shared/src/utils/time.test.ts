/**
 * P2-3 (finding H-3, DEC-2) — a "day" is the user's local calendar day.
 *
 * These helpers are the single definition of that day. They are built on
 * `Intl.DateTimeFormat`, so the tz database handles DST transitions instead of
 * fixed offsets. Storage stays UTC (invariant I-004); only bucketing changes.
 */

import { describe, expect, it } from 'vitest';
import { addDaysToDayKey, localDayBounds, localDayKey, isValidTimeZone } from './time.js';

const AMS = 'Europe/Amsterdam';

describe('localDayKey', () => {
  it('files 00:30 local on that local day, not the previous UTC day', () => {
    // 2026-04-01 00:30 CEST === 2026-03-31T22:30Z
    expect(localDayKey('2026-03-31T22:30:00.000Z', AMS)).toBe('2026-04-01');
  });

  it('files 23:30 local on that local day', () => {
    // 2026-04-01 23:30 CEST === 2026-04-01T21:30Z
    expect(localDayKey('2026-04-01T21:30:00.000Z', AMS)).toBe('2026-04-01');
  });

  it('defaults to UTC so an untouched install is unchanged', () => {
    expect(localDayKey('2026-03-31T22:30:00.000Z')).toBe('2026-03-31');
  });
});

describe('localDayBounds', () => {
  it('returns a half-open range that starts at local midnight', () => {
    const { start, endExclusive } = localDayBounds('2026-04-01', AMS);

    expect(start.toISOString()).toBe('2026-03-31T22:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-04-01T22:00:00.000Z');
  });

  it('has 23 hours on the spring-forward day', () => {
    const { start, endExclusive } = localDayBounds('2026-03-29', AMS);

    expect((endExclusive.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });

  it('has 25 hours on the fall-back day', () => {
    const { start, endExclusive } = localDayBounds('2026-10-25', AMS);

    expect((endExclusive.getTime() - start.getTime()) / 3_600_000).toBe(25);
  });

  it('splits exactly at a local month boundary', () => {
    const march = localDayBounds('2026-03-31', AMS);
    const april = localDayBounds('2026-04-01', AMS);

    expect(march.endExclusive.toISOString()).toBe('2026-03-31T22:00:00.000Z');
    expect(april.start.toISOString()).toBe('2026-03-31T22:00:00.000Z');
  });
});

describe('addDaysToDayKey', () => {
  it('crosses month and year boundaries', () => {
    expect(addDaysToDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDayKey('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('isValidTimeZone', () => {
  it('accepts an IANA zone and rejects garbage', () => {
    expect(isValidTimeZone('Europe/Amsterdam')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('+02:00')).toBe(false);
  });
});
