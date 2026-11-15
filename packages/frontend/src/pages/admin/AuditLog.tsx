import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QueryState } from '@/components/QueryState';
import { api, type AdminAuthEvent } from '@/lib/api';
import { useAuthContext } from '@/lib/authContext';

/**
 * Administrator audit viewer (Q12).
 *
 * Read-only and newest-first. The server prunes rows older than 90 days on
 * every read, so this screen never has to explain retention it cannot enforce.
 */

const PAGE_SIZE = 25;

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function humaniseKind(kind: string): string {
  return kind.replace(/_/g, ' ');
}

/** The few metadata fields that make an audit row useful at a glance. */
function describeMeta(event: AdminAuthEvent): string {
  if (!event.meta) {
    return '—';
  }

  const target = event.meta.targetUserId;
  if (typeof target === 'string') {
    const email = event.meta.targetEmail;
    return typeof email === 'string' ? email : `Account ${target.slice(0, 8)}…`;
  }

  if (typeof event.meta.email === 'string') {
    return event.meta.email;
  }

  const parts = Object.entries(event.meta)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);

  return parts.length > 0 ? parts.join(', ') : '—';
}

export function AdminAuditLog() {
  const { mfaEnrolmentRequired } = useAuthContext();
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['admin', 'auth-events', page],
    queryFn: () => api.admin.authEvents(page, PAGE_SIZE),
    enabled: !mfaEnrolmentRequired,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  // The Users card is the one that explains the MFA requirement; rendering a
  // second failing panel for it would be noise.
  if (mfaEnrolmentRequired) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollText className="h-4 w-4" />
          Audit log
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Sign-ins, password changes, MFA changes and every administrator action. Entries older than
          90 days are removed automatically.
        </p>

        <QueryState
          isLoading={isLoading}
          isError={isError}
          error={error}
          errorTitle="Could not load the audit log"
          onRetry={() => refetch()}
          isEmpty={!isLoading && !isError && (data?.events.length ?? 0) === 0}
          emptyTitle="No events yet"
          className="py-8"
        >
          <ul className="divide-y">
            {data?.events.map((event) => (
              // Stacked rows rather than a five-column table: at 390px the
              // table only fit "When" and "Event", so actor, details and IP
              // were hidden behind a scrollbar nobody could see.
              <li key={event.id} className="space-y-0.5 py-2 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm font-medium capitalize">
                    {humaniseKind(event.kind)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDate(event.createdAt)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {event.actor ? event.actor.username : '—'} · {describeMeta(event)}
                  {event.ip ? ` · ${event.ip}` : ''}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Page {data?.page ?? page} of {totalPages}
              {data ? ` · ${data.total} ${data.total === 1 ? 'event' : 'events'}` : ''}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={page <= 1 || isLoading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
                Newer
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={!data?.hasMore || isLoading}
                onClick={() => setPage((current) => current + 1)}
              >
                Older
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </QueryState>
      </CardContent>
    </Card>
  );
}
