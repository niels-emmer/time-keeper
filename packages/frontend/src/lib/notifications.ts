/**
 * Timer notification helpers (page side)
 *
 * The SW owns the notification lifecycle. These helpers send messages to the
 * SW to start/stop tracking, and handle the TIMER_STOPPED message the SW
 * broadcasts when the user taps "Stop" on the notification.
 *
 * Message protocol (page → SW):
 *   { type: 'START_TRACKING', categoryName: string, startTime: string }
 *   { type: 'STOP_TRACKING' }
 *
 * Message protocol (SW → page):
 *   { type: 'TIMER_STOPPED' }
 */

/** Ask for notification permission if we don't already have it. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const result = await Notification.requestPermission();
  return result === 'granted';
}

/** True when we can show notifications. */
export function canNotify(): boolean {
  return (
    'Notification' in window &&
    Notification.permission === 'granted' &&
    'serviceWorker' in navigator
  );
}

/** Send a message to the active SW. No-op if SW is not ready. */
async function sendToSW(msg: object): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.active?.postMessage(msg);
  } catch {
    // SW not available — ignore
  }
}

/**
 * Tell the SW to show a persistent notification and start polling.
 * Called when a timer starts or when the component mounts with an active timer.
 */
export async function startTimerNotification(
  categoryName: string,
  startTime: string
): Promise<void> {
  if (!canNotify()) return;
  await sendToSW({ type: 'START_TRACKING', categoryName, startTime });
}

/**
 * Tell the SW to stop polling and clear the notification.
 * Called when the timer is stopped from the page.
 */
export async function stopTimerNotification(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  await sendToSW({ type: 'STOP_TRACKING' });
}

/**
 * Register a one-time listener for the TIMER_STOPPED message from the SW.
 * The SW sends this when the user taps "Stop" on the notification while the
 * app window is open, so the page can refresh its state.
 *
 * Returns an unsubscribe function.
 */
export function onSWTimerStopped(callback: () => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {};

  const handler = (event: MessageEvent) => {
    if ((event.data as { type?: string })?.type === 'TIMER_STOPPED') {
      callback();
    }
  };

  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
}
