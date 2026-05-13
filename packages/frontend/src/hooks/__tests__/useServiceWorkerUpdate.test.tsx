import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useServiceWorkerUpdate } from '../useServiceWorkerUpdate';

describe('useServiceWorkerUpdate', () => {
  const originalLocation = window.location;

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('flags an already waiting service worker as an available update', async () => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: { postMessage: vi.fn() },
        getRegistrations: vi.fn().mockResolvedValue([
          {
            waiting: { postMessage: vi.fn() },
            addEventListener: vi.fn(),
          },
        ]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    const { result } = renderHook(() => useServiceWorkerUpdate());

    await waitFor(() => {
      expect(result.current.updateAvailable).toBe(true);
    });
  });

  it('requests skip waiting and reloads once the new worker takes control', async () => {
    const waitingPostMessage = vi.fn();
    const listeners = new Map<string, EventListener>();
    const reload = vi.fn();

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: { postMessage: vi.fn() },
        getRegistrations: vi.fn().mockResolvedValue([
          {
            waiting: { postMessage: waitingPostMessage },
            addEventListener: vi.fn(),
          },
        ]),
        addEventListener: vi.fn((type: string, handler: EventListener) => listeners.set(type, handler)),
        removeEventListener: vi.fn(),
      },
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
});
