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
});
