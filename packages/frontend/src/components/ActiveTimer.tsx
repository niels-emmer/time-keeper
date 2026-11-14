import { useEffect, useRef, useState } from 'react';
import { Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { InlineError } from '@/components/QueryState';
import { useQueryClient } from '@tanstack/react-query';
import { useStopTimer } from '@/hooks/useTimer';
import { getErrorMessage } from '@/lib/api';
import { formatElapsed } from '@time-keeper/shared';
import type { TimeEntry } from '@time-keeper/shared';
import {
  onSWTimerStopped,
  requestNotificationPermission,
  startTimerNotification,
  stopTimerNotification,
} from '@/lib/notifications';

interface Props {
  entry: TimeEntry;
  categoryName: string;
  categoryColor: string;
}

function computeElapsedSeconds(startTime: string): number {
  const startMs = new Date(startTime).getTime();
  if (Number.isNaN(startMs)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
}

export function ActiveTimer({ entry, categoryName, categoryColor }: Props) {
  const stop = useStopTimer();
  const qc = useQueryClient();
  const [elapsed, setElapsed] = useState(() => computeElapsedSeconds(entry.startTime));
  const [stopError, setStopError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // ── Elapsed time: the worker is the single ticker ─────────────────────────
  // The main-thread interval is only a fallback for environments where a
  // worker cannot be constructed or fails at runtime (finding L-11).
  useEffect(() => {
    setElapsed(computeElapsedSeconds(entry.startTime));

    let fallbackIntervalId: number | null = null;
    const startFallback = () => {
      if (fallbackIntervalId !== null) return;
      fallbackIntervalId = window.setInterval(() => {
        setElapsed(computeElapsedSeconds(entry.startTime));
      }, 1000);
    };

    try {
      const worker = new Worker(new URL('../workers/timer.worker.ts', import.meta.url), {
        type: 'module',
      });

      worker.onmessage = (event: MessageEvent<{ type: 'tick'; elapsed: number }>) => {
        if (event.data.type === 'tick') {
          setElapsed(event.data.elapsed);
        }
      };

      worker.onerror = () => {
        // The worker loaded but could not run — keep the display moving.
        worker.terminate();
        workerRef.current = null;
        startFallback();
      };

      worker.postMessage({ type: 'start', startTime: entry.startTime });
      workerRef.current = worker;
    } catch {
      // Worker unsupported or blocked — fall back to the main thread.
      workerRef.current = null;
      startFallback();
    }

    return () => {
      if (fallbackIntervalId !== null) {
        window.clearInterval(fallbackIntervalId);
      }
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'stop' });
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [entry.startTime]);

  // ── Document title: reflect running timer in the tab/window title ─────────
  useEffect(() => {
    const timeStr = formatElapsed(elapsed);
    document.title = `${timeStr} · ${categoryName} – Time Keeper`;
    return () => {
      document.title = 'Time Keeper';
    };
  }, [elapsed, categoryName]);

  // ── Notifications: tell SW to own the notification lifecycle ─────────────
  useEffect(() => {
    // Ask for permission lazily (first time the timer appears)
    requestNotificationPermission().then((granted) => {
      if (granted) {
        startTimerNotification(categoryName, entry.startTime);
      }
    });

    // Clean up: SW clears notification when we explicitly stop from the page,
    // but if this component unmounts for any other reason we don't clear it —
    // the SW keeps the notification alive and continues polling independently.
  }, [categoryName, entry.startTime]);

  // ── SW → page: handle Stop tapped on the notification ────────────────────
  useEffect(() => {
    const unsubscribe = onSWTimerStopped(() => {
      // The SW already called the API — just refresh React Query state
      qc.invalidateQueries({ queryKey: ['timer'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['entries'] });
    });
    return unsubscribe;
  }, [qc]);

  // ── Stop handler (Stop button in the UI) ──────────────────────────────────
  const handleStop = () => {
    setStopError(null);
    stopTimerNotification();
    stop.mutate(undefined, {
      onError: (error) =>
        setStopError(getErrorMessage(error, 'Could not stop the timer. Try again.')),
    });
  };

  return (
    <Card className="border-2" style={{ borderColor: categoryColor }}>
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <span
            className="inline-block h-3 w-3 animate-pulse rounded-full"
            style={{ backgroundColor: categoryColor }}
          />
          <div>
            <p className="text-sm text-muted-foreground">Tracking</p>
            <p className="font-semibold">{categoryName}</p>

          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-xl font-bold tabular-nums">{formatElapsed(elapsed)}</span>
          <Button
            variant="destructive"
            size="icon"
            onClick={handleStop}
            disabled={stop.isPending}
            aria-label="Stop timer"
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        </div>
      </CardContent>
      {stopError && (
        <div className="px-4 pb-4">
          <InlineError message={stopError} onDismiss={() => setStopError(null)} />
        </div>
      )}
    </Card>
  );
}
