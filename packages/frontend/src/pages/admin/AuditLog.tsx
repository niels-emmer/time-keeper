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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">Event</th>
                  <th className="pb-2 font-medium">Actor</th>
                  <th className="pb-2 font-medium">Details</th>
                  <th className="pb-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {data?.events.map((event) => (
                  <tr key={event.id} className="border-b last:border-0 align-top">
                    <td className="whitespace-nowrap py-2 pr-4 text-muted-foreground">
                      {formatDate(event.createdAt)}
                    </td>
                    <td className="py-2 pr-4 font-medium capitalize">{humaniseKind(event.kind)}</td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {event.actor ? event.actor.username : '—'}
                    </td>
                    <td className="max-w-[18rem] py-2 pr-4 text-muted-foreground">
                      {describeMeta(event)}
                    </td>
                    <td className="py-2 text-muted-foreground">{event.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
