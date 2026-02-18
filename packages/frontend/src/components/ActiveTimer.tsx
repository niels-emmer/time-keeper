import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useStopTimer } from '@/hooks/useTimer';
import { formatElapsed } from '@time-keeper/shared';
import type { TimeEntry } from '@time-keeper/shared';

interface Props {
  entry: TimeEntry;
  categoryName: string;
  categoryColor: string;
}

export function ActiveTimer({ entry, categoryName, categoryColor }: Props) {
  const stop = useStopTimer();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = new Date(entry.startTime).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [entry.startTime]);

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
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
            aria-label="Stop timer"
          >
            <Square className="h-4 w-4 fill-current" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
