import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActiveTimer } from '../ActiveTimer';

const { stopTimerMock, notificationMocks } = vi.hoisted(() => ({
  stopTimerMock: {
    mutate: vi.fn(),
    isPending: false,
  },
  notificationMocks: {
    onSWTimerStopped: vi.fn(() => () => {}),
    requestNotificationPermission: vi.fn(async () => false),
    startTimerNotification: vi.fn(async () => {}),
    stopTimerNotification: vi.fn(async () => {}),
  },
}));

vi.mock('@/hooks/useTimer', () => ({
  useStopTimer: () => stopTimerMock,
}));

vi.mock('@/lib/notifications', () => notificationMocks);

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ActiveTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-13T12:00:10.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows elapsed time and keeps ticking when the worker cannot start', () => {
    class FailingWorker {
      constructor() {
        throw new Error('worker unsupported');
      }
    }

    vi.stubGlobal('Worker', FailingWorker);

    renderWithClient(
      <ActiveTimer
        entry={{
          id: 1,
          userId: 'alice@example.com',
          categoryId: 1,
          startTime: '2026-05-13T12:00:00.000Z',
          endTime: null,
          notes: null,
          rounded: false,
          createdAt: '2026-05-13T12:00:00.000Z',
          updatedAt: '2026-05-13T12:00:00.000Z',
        }}
        categoryName="Project Alpha"
        categoryColor="#3366ff"
      />
    );

    expect(screen.getByText('0:00:10')).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('0:00:12')).not.toBeNull();
  });

  // Finding L-11: the worker must be the single ticker; no fallback interval
  // may run alongside it.
  it('uses the worker as the only ticker when it starts successfully', () => {
    const workers: Array<{
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: (() => void) | null;
      postMessage: () => void;
      terminate: () => void;
    }> = [];

    class WorkingWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage = vi.fn();
      terminate = vi.fn();

      constructor() {
        workers.push(this);
      }
    }

    vi.stubGlobal('Worker', WorkingWorker);
    const intervalSpy = vi.spyOn(window, 'setInterval');

    renderWithClient(
      <ActiveTimer
        entry={{
          id: 1,
          userId: 'alice@example.com',
          categoryId: 1,
          startTime: '2026-05-13T12:00:00.000Z',
          endTime: null,
          notes: null,
          rounded: false,
          createdAt: '2026-05-13T12:00:00.000Z',
          updatedAt: '2026-05-13T12:00:00.000Z',
        }}
        categoryName="Project Alpha"
        categoryColor="#3366ff"
      />
    );

    expect(workers).toHaveLength(1);
    expect(intervalSpy.mock.calls.some(([, delay]) => delay === 1000)).toBe(false);

    act(() => {
      workers[0].onmessage?.({ data: { type: 'tick', elapsed: 42 } } as MessageEvent);
    });

    expect(screen.getByText('0:00:42')).not.toBeNull();
  });
});
