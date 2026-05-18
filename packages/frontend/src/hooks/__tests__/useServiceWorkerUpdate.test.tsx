import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useServiceWorkerUpdate } from '../useServiceWorkerUpdate';

function mockServiceWorker(registrations: ServiceWorkerRegistration[]) {
  const listeners = new Map<string, EventListener>();

  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    value: true,
  });

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      controller: { postMessage: vi.fn() },
      getRegistrations: vi.fn().mockResolvedValue(registrations),
      addEventListener: vi.fn((type: string, handler: EventListener) => listeners.set(type, handler)),
      removeEventListener: vi.fn(),
    },
  });

  return listeners;
}

async function flushServiceWorkerChecks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useServiceWorkerUpdate', () => {
  const originalLocation = window.location;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('flags an already waiting service worker as an available update', async () => {
    mockServiceWorker([
      {
        waiting: { postMessage: vi.fn() } as unknown as ServiceWorker,
        addEventListener: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
      } as unknown as ServiceWorkerRegistration,
    ]);

    const { result } = renderHook(() => useServiceWorkerUpdate());

    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(true);
    });
  });

  it('requests skip waiting and reloads once the new worker takes control', async () => {
    const waitingPostMessage = vi.fn();
    const listeners = mockServiceWorker([
      {
        waiting: { postMessage: waitingPostMessage } as unknown as ServiceWorker,
        addEventListener: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
      } as unknown as ServiceWorkerRegistration,
    ]);
    const reload = vi.fn();

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });

    const { result } = renderHook(() => useServiceWorkerUpdate());

    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(true);
    });

    act(() => {
      result.current.applyUpdate();
    });

    expect(waitingPostMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });

    const controllerChangeHandler = listeners.get('controllerchange');
    act(() => {
      controllerChangeHandler?.(new Event('controllerchange'));
    });

    expect(reload).toHaveBeenCalled();
  });

  it('checks for updates on mount and when the app becomes visible again', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-18T12:00:00Z'));

    const update = vi.fn().mockResolvedValue(undefined);
    mockServiceWorker([
      {
        waiting: null,
        installing: null,
        addEventListener: vi.fn(),
        update,
      } as unknown as ServiceWorkerRegistration,
    ]);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    renderHook(() => useServiceWorkerUpdate());
    await flushServiceWorkerChecks();

    expect(update).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(61_000);

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flushServiceWorkerChecks();

    expect(update).toHaveBeenCalledTimes(2);
  });

  it('rechecks immediately when the browser comes back online', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    mockServiceWorker([
      {
        waiting: null,
        installing: null,
        addEventListener: vi.fn(),
        update,
      } as unknown as ServiceWorkerRegistration,
    ]);

    renderHook(() => useServiceWorkerUpdate());

    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(1);
    });

    act(() => {
      window.dispatchEvent(new Event('online'));
    });

    await waitFor(() => {
      expect(update).toHaveBeenCalledTimes(2);
    });
  });
});
