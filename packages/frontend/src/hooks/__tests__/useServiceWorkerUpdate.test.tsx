import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useServiceWorkerUpdate } from '../useServiceWorkerUpdate';

describe('useServiceWorkerUpdate', () => {
  const originalLocation = window.location;

  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('prompts for an already waiting service worker and requests skip waiting', async () => {
    const waitingPostMessage = vi.fn();
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();

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
        addEventListener,
        removeEventListener,
      },
    });

    renderHook(() => useServiceWorkerUpdate());

    await waitFor(() => {
      expect(waitingPostMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
      expect(confirm).toHaveBeenCalled();
    });
  });

  it('reloads once the new service worker takes control after confirmation', async () => {
    const controllerPostMessage = vi.fn();
    const listeners = new Map<string, EventListener>();
    const reload = vi.fn();

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        controller: { postMessage: controllerPostMessage },
        getRegistrations: vi.fn().mockResolvedValue([]),
        addEventListener: vi.fn((type: string, handler: EventListener) => listeners.set(type, handler)),
        removeEventListener: vi.fn(),
      },
    });

    renderHook(() => useServiceWorkerUpdate());

    const messageHandler = listeners.get('message');
    expect(messageHandler).toBeDefined();

    messageHandler?.({ data: { type: 'installed' } } as MessageEvent);

    await waitFor(() => {
      expect(controllerPostMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    });

    const controllerChangeHandler = listeners.get('controllerchange');
    controllerChangeHandler?.(new Event('controllerchange'));

    expect(reload).toHaveBeenCalled();
  });
});