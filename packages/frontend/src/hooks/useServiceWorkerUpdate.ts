import { useEffect } from 'react';

/**
 * Hook that listens for service worker updates and prompts the user to reload.
 * The vite-plugin-pwa with registerType: 'autoUpdate' checks for updates in the
 * background. When a new version is found, this hook prompts the user to reload.
 */
export function useServiceWorkerUpdate() {
  useEffect(() => {
    if (!navigator.serviceWorker) return;

    // Listen for controller changes (when a new SW takes control)
    let updateRequested = false;

    const handleControllerChange = () => {
      if (updateRequested) {
        window.location.reload();
      }
    };

    // Listen for messages from the SW (Workbox sends these on update)
    const handleSWMessage = (event: MessageEvent) => {
      // vite-plugin-pwa posts messages about updates; check for the standard pattern
      if (event.data?.type === 'SKIP_WAITING_ACK' || (event.data?.type === 'installed')) {
        // New SW is ready
        if (confirm('New version available. Reload now?')) {
          // Tell the SW to skip waiting and take control
          const controller = navigator.serviceWorker.controller;
          if (controller) {
            updateRequested = true;
            controller.postMessage({ type: 'SKIP_WAITING' });
            navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
          }
        }
      }
    };

    // Listen for registration updates
    const registrations = navigator.serviceWorker.getRegistrations();
    registrations.then((regs) => {
      regs.forEach((reg) => {
        // If there's already a waiting SW, prompt immediately
        if (reg.waiting) {
          if (confirm('New version available. Reload now?')) {
            updateRequested = true;
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
            navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
          }
        }

        // Listen for updates
        reg.addEventListener('updatefound', () => {
          if (reg.installing) {
            reg.installing.addEventListener('statechange', () => {
              if (
                reg.installing?.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                // There's a new SW ready
                if (confirm('New version available. Reload now?')) {
                  updateRequested = true;
                  reg.installing?.postMessage({ type: 'SKIP_WAITING' });
                  navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
                }
              }
            });
          }
        });
      });
    });

    // Also listen for SW messages (in case Workbox sends update notifications)
    navigator.serviceWorker.addEventListener('message', handleSWMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);
}
