import type { ReactNode } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/lib/api';

interface QueryStateProps {
  /** The first load (or a refetch with no cached data) is in flight. */
  isLoading?: boolean;
  /** The query failed — renders the message plus, when provided, a Retry. */
  isError?: boolean;
  /** The query succeeded but there is nothing to show. */
  isEmpty?: boolean;
  /** The thrown value, when known. */
  error?: unknown;
  onRetry?: () => void;
  onDismiss?: () => void;
  loadingLabel?: string;
  errorTitle?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * One presentation boundary for the three states every query surface needs:
 * loading, error + Retry, and empty. It exists so a failed fetch can never
 * render as a blank panel (finding M-3).
 */
export function QueryState({
  isLoading = false,
  isError = false,
  isEmpty = false,
  error,
  onRetry,
  onDismiss,
  loadingLabel = 'Loading…',
  errorTitle = 'Something went wrong',
  emptyTitle,
  emptyDescription,
  className,
  children,
}: QueryStateProps) {
  if (isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn('flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground', className)}
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        <p className="text-sm">{loadingLabel}</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div
        role="alert"
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-2xl border border-destructive/40 bg-card px-4 py-10 text-center',
          className
        )}
      >
        <AlertCircle className="h-5 w-5 text-destructive" aria-hidden="true" />
        <p className="text-sm font-medium">{errorTitle}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{getErrorMessage(error)}</p>
        {(onRetry || onDismiss) && (
          <div className="mt-1 flex items-center gap-2">
            {onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            )}
            {onDismiss && (
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center rounded-2xl border border-dashed py-12 text-center text-muted-foreground',
          className
        )}
      >
        <p className="text-lg">{emptyTitle}</p>
        {emptyDescription && <p className="mt-1 text-sm">{emptyDescription}</p>}
      </div>
    );
  }

  return <>{children}</>;
}

interface InlineErrorProps {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

/**
 * Compact, dismissible error banner for mutations and secondary queries that
 * sit inside an otherwise usable panel.
 */
export function InlineError({ message, onRetry, onDismiss, className }: InlineErrorProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-start gap-3 rounded-xl border border-destructive/40 bg-card px-3 py-2 text-sm',
        className
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <p className="flex-1 text-destructive">{message}</p>
      <div className="flex shrink-0 items-center gap-1">
        {onRetry && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={onRetry}>
            Retry
          </Button>
        )}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss error"
            className="rounded p-1 text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
