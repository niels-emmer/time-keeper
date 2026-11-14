import { describe, expect, it } from 'vitest';
import { getTimerRefetchInterval, TIMER_POLL_INTERVAL_MS } from '../useTimer';

describe('getTimerRefetchInterval', () => {
  // Finding L-11: an idle tab used to poll /api/timer forever.
  it('does not poll while no timer is active', () => {
    expect(getTimerRefetchInterval(false)).toBe(false);
  });

  it('polls on the shared cadence while a timer runs', () => {
    expect(getTimerRefetchInterval(true)).toBe(TIMER_POLL_INTERVAL_MS);
    expect(TIMER_POLL_INTERVAL_MS).toBe(5000);
  });
});
