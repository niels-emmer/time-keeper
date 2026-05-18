import { useCallback, useEffect, useRef, useState } from 'react';

const UPDATE_CHECK_THROTTLE_MS = 60_000;

export function useServiceWorkerUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const registrationsRef = useRef<readonly ServiceWorkerRegistration[]>([]);
  const observedRegistrationsRef = useRef(new WeakSet<ServiceWorkerRegistration>());
  const applyingUpdateRef = useRef(false);
  const lastCheckAtRef = useRef(0);

  const markUpdateAvailable = useCallback((worker?: ServiceWorker | null) => {
    if (worker) {
      waitingWorkerRef.current = worker;
    }
    setUpdateAvailable(true);
  }, []);

  const observeRegistration = useCallback(
    (registration: ServiceWorkerRegistration) => {
      if (observedRegistrationsRef.current.has(registration)) return;
      observedRegistrationsRef.current.add(registration);

      if (registration.waiting) {
        markUpdateAvailable(registration.waiting);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            markUpdateAvailable(registration.waiting ?? installing ?? null);
          }
        });
      });
    },
    [markUpdateAvailable]
  );

  const loadRegistrations = useCallback(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    registrationsRef.current = registrations;
    registrations.forEach(observeRegistration);
    return registrations;
  }, [observeRegistration]);

  const checkForUpdates = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!navigator.serviceWorker) return;
      if ('onLine' in navigator && !navigator.onLine) return;

      const now = Date.now();
      if (!force && now - lastCheckAtRef.current < UPDATE_CHECK_THROTTLE_MS) {
        return;
      }
      lastCheckAtRef.current = now;

      try {
        const registrations =
          registrationsRef.current.length > 0 ? registrationsRef.current : await loadRegistrations();

        await Promise.all(
          registrations.map(async (registration) => {
            if (registration.waiting) {
              markUpdateAvailable(registration.waiting);
              return;
            }

            try {
              await registration.update();
            } catch {
              // Ignore transient update failures. The next resume/reconnect will retry.
            }
          })
        );
      } catch {
        // Ignore transient registration lookup failures.
      }
    },
    [loadRegistrations, markUpdateAvailable]
  );

  const applyUpdate = useCallback(() => {
    const target = waitingWorkerRef.current ?? navigator.serviceWorker?.controller ?? null;
    if (!target) return;

    applyingUpdateRef.current = true;
    setApplyingUpdate(true);
    target.postMessage({ type: 'SKIP_WAITING' });
  }, []);

  const dismissUpdate = useCallback(() => {
    setUpdateAvailable(false);
  }, []);

  useEffect(() => {
    if (!navigator.serviceWorker) return;

    const handleControllerChange = () => {
      if (applyingUpdateRef.current) {
        window.location.reload();
      }
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'installed' || event.data?.type === 'SKIP_WAITING_ACK') {
        markUpdateAvailable(waitingWorkerRef.current);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdates();
      }
    };

    const handleResume = () => {
      void checkForUpdates();
    };

    const handleReconnect = () => {
      void checkForUpdates({ force: true });
    };

    void checkForUpdates({ force: true });

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);
    navigator.serviceWorker.addEventListener('message', handleMessage);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleResume);
    window.addEventListener('pageshow', handleResume);
    window.addEventListener('online', handleReconnect);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      navigator.serviceWorker.removeEventListener('message', handleMessage);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('pageshow', handleResume);
      window.removeEventListener('online', handleReconnect);
    };
  }, [checkForUpdates, markUpdateAvailable]);

  return {
    updateAvailable,
    applyingUpdate,
    applyUpdate,
    dismissUpdate,
  };
}
