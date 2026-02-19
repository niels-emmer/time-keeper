/**
 * Timer Web Worker
 *
 * Runs the 1-second tick off the main thread so elapsed time stays accurate
 * even when the tab is hidden or the device is under load.
 *
 * Protocol (main → worker):
 *   { type: 'start', startTime: string }  – ISO timestamp of timer start
 *   { type: 'stop' }                      – stop ticking
 *
 * Protocol (worker → main):
 *   { type: 'tick', elapsed: number }     – elapsed seconds since startTime
 */

let intervalId: ReturnType<typeof setInterval> | null = null;

self.onmessage = (event: MessageEvent<{ type: 'start'; startTime: string } | { type: 'stop' }>) => {
  const msg = event.data;

  if (msg.type === 'start') {
    // Clear any existing interval before starting a new one
    if (intervalId !== null) {
      clearInterval(intervalId);
    }

    const startMs = new Date(msg.startTime).getTime();

    const tick = () => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      self.postMessage({ type: 'tick', elapsed });
    };

    // Fire immediately, then every second
    tick();
    intervalId = setInterval(tick, 1000);
  } else if (msg.type === 'stop') {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
};
