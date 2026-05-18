/// <reference lib="webworker" />
/**
 * Custom Service Worker entry point
 *
 * Vite-plugin-pwa injects the Workbox precache manifest into this file at
 * build time.  We extend it with:
 *
 *  - Notification lifecycle ownership: the SW shows a persistent
 *    "timer running" notification independently of whether any app window is
 *    open, and polls /api/timer every 60 s on a best-effort basis so it can
 *    clear stale notifications when the timer ends elsewhere.
 *
 *  - Notification action buttons: "Stop" calls POST /api/timer/stop directly
 *    from the SW so the timer can be stopped without opening the app.
 *
 *  - Message protocol (page → SW):
 *      { type: 'START_TRACKING', categoryName: string, startTime: string }
 *      { type: 'STOP_TRACKING' }
 *
 *  - notificationclick: tapping the notification body focuses/opens the app;
 *    tapping the "Stop" action calls the API and clears the notification.
 */

import { precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, NetworkOnly } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope;
declare const __INSTALL_NOTIFICATION_ICON_URL__: string;
declare const __INSTALL_NOTIFICATION_BADGE_URL__: string;

// ── Workbox setup ──────────────────────────────────────────────────────────

// Navigation requests (full-page loads) must hit the network first so that
// Authentik's forward-auth proxy can issue a login redirect when the session
// has expired.  Without this, Workbox serves the cached index.html and
// Authentik never gets a chance to redirect.  Falls back to the precached
// shell after 3 s so the app still loads when the network is unavailable.
registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({ networkTimeoutSeconds: 3 })
);

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkOnly()
);

// ── Constants ──────────────────────────────────────────────────────────────
const NOTIFICATION_TAG = 'time-keeper-timer';
const POLL_INTERVAL_MS = 60_000; // best-effort timer-state recheck every 60 s

// ── State ──────────────────────────────────────────────────────────────────
let pollTimerId: ReturnType<typeof setTimeout> | null = null;
let currentCategoryName: string | null = null;
let currentStartTime: string | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────

async function showNotification(categoryName: string, startTime: string): Promise<void> {
  await self.registration.showNotification('Time Keeper – timer running', {
    tag: NOTIFICATION_TAG,
    body: categoryName,
    icon: __INSTALL_NOTIFICATION_ICON_URL__,
    badge: __INSTALL_NOTIFICATION_BADGE_URL__,
    silent: true,
    renotify: false,
    requireInteraction: true,
    timestamp: new Date(startTime).getTime(),
    data: { url: '/', categoryName, startTime },
    actions: [
      { action: 'stop', title: 'Stop timer' },
    ],
  } as NotificationOptions);
}

async function clearNotification(): Promise<void> {
  const notifications = await self.registration.getNotifications({ tag: NOTIFICATION_TAG });
  notifications.forEach((n) => n.close());
}

function stopPolling(): void {
  if (pollTimerId !== null) {
    clearTimeout(pollTimerId);
    pollTimerId = null;
  }
  currentCategoryName = null;
  currentStartTime = null;
}

function schedulePoll(): void {
  pollTimerId = setTimeout(async () => {
    // Re-verify the timer is still running by polling the API
    try {
      const res = await fetch('/api/timer', { credentials: 'same-origin' });
      if (!res.ok) {
        // Auth expired or server error — clear notification and stop polling
        await clearNotification();
        stopPolling();
        return;
      }
      const data = (await res.json()) as
        | { active: false }
        | { active: true; entry: { categoryId: number; startTime: string } };

      if (!data.active) {
        await clearNotification();
        stopPolling();
        return;
      }

      // Timer still running — keep polling so we can clear the notification
      // if the timer stops elsewhere. We intentionally avoid showing a live
      // elapsed counter here because background SW timers are not reliable on
      // Android and can leave stale durations in the drawer.
    } catch {
      // Network error — keep polling optimistically, don't clear notification
    }

    // Schedule the next poll only if we're still tracking
    if (currentCategoryName !== null) {
      schedulePoll();
    }
  }, POLL_INTERVAL_MS);
}

async function startTracking(categoryName: string, startTime: string): Promise<void> {
  // Clear any existing poll cycle before starting a new one
  stopPolling();
  currentCategoryName = categoryName;
  currentStartTime = startTime;
  await showNotification(categoryName, startTime);
  schedulePoll();
}

async function stopTracking(): Promise<void> {
  stopPolling();
  await clearNotification();
}

// ── Message handler (page → SW) ────────────────────────────────────────────
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const msg = event.data as
    | { type: 'START_TRACKING'; categoryName: string; startTime: string }
    | { type: 'STOP_TRACKING' }
    | { type: 'SKIP_WAITING' };

  if (msg.type === 'START_TRACKING') {
    event.waitUntil(startTracking(msg.categoryName, msg.startTime));
  } else if (msg.type === 'STOP_TRACKING') {
    event.waitUntil(stopTracking());
  } else if (msg.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── SW activate: re-check timer state on SW restart ────────────────────────
// When the browser restarts and the SW wakes up (e.g. push event or next
// navigation), we re-poll once so any in-progress timer gets its notification
// restored without needing the page to be open.
self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch('/api/timer', { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = (await res.json()) as
          | { active: false }
          | { active: true; entry: { categoryId: number; startTime: string; categoryName?: string } };

        if (data.active) {
          // We don't have the category name here — show a generic notification.
          // The page will send START_TRACKING with the full name once it loads.
          const startTime = data.entry.startTime;
          currentStartTime = startTime;
          currentCategoryName = 'timer';
          await showNotification('Timer running', startTime);
          schedulePoll();
        }
      } catch {
        // Ignore — SW may not have auth cookies yet
      }
    })()
  );
});

// ── Notification click handler ─────────────────────────────────────────────
self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  if (event.action === 'stop') {
    // Stop the timer directly from the SW, then clear the notification
    event.waitUntil(
      (async () => {
        try {
          await fetch('/api/timer/stop', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
        } catch {
          // Best-effort — if fetch fails, the notification is already closed
        }
        stopPolling();
        await clearNotification();

        // Tell any open app window to refresh its timer state
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: 'TIMER_STOPPED' });
        }
      })()
    );
    return;
  }

  // Default action (tap notification body) → focus or open the app
  const targetUrl: string = (event.notification.data as { url?: string })?.url ?? '/';
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clients) {
        if ('focus' in client) {
          await (client as WindowClient).focus();
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })()
  );
});
