import { useCallback, useEffect, useRef, useState } from 'react';

export function useServiceWorkerUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);

  const markUpdateAvailable = useCallback((worker?: ServiceWorker | null) => {
    if (worker) {
      waitingWorkerRef.current = worker;
    }
    setUpdateAvailable(true);
  }, []);

  const applyUpdate = useCallback(() => {
    const target = waitingWorkerRef.current ?? navigator.serviceWorker?.controller ?? null;
    if (!target) return;

    setApplyingUpdate(true);
    target.postMessage({ type: 'SKIP_WAITING' });
  }, []);

  const dismissUpdate = useCallback(() => {
    setUpdateAvailable(false);
  }, []);

  useEffect(() => {
    if (!navigator.serviceWorker) return;

    const handleControllerChange = () => {
      if (applyingUpdate) {
        window.location.reload();
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'installed' || event.data?.type === 'SKIP_WAITING_ACK') {
        markUpdateAvailable(waitingWorkerRef.current);
      }
    };

    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        if (registration.waiting) {
          markUpdateAvailable(registration.waiting);
        }

        registration.addEventListener('updatefound', () => {
          if (!registration.installing) return;
          registration.installing.addEventListener('statechange', () => {
            if (registration.installing?.state === 'installed' && navigator.serviceWorker.controller) {
              markUpdateAvailable(registration.waiting ?? registration.installing ?? null);
            }
          });
        });
      });
    });

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    navigator.serviceWorker.addEventListener('message', handleMessage);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    };
  }, [applyingUpdate, markUpdateAvailable]);

  return {
    updateAvailable,
    applyingUpdate,
    applyUpdate,
    dismissUpdate,
  };
}
