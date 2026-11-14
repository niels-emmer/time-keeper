import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineError, QueryState } from '../QueryState';

describe('QueryState', () => {
  it('renders a loading status instead of an empty panel', () => {
    render(<QueryState isLoading loadingLabel="Loading widgets…" />);

    expect(screen.getByRole('status')).not.toBeNull();
    expect(screen.getByText('Loading widgets…')).not.toBeNull();
  });

  it('renders the error message and a Retry that refetches', () => {
    const onRetry = vi.fn();

    render(
      <QueryState
        isError
        error={new Error('Server exploded')}
        errorTitle="Could not load"
        onRetry={onRetry}
      />
    );

    expect(screen.getByRole('alert').textContent).toContain('Could not load');
    expect(screen.getByRole('alert').textContent).toContain('Server exploded');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an empty state instead of returning null', () => {
    render(
      <QueryState isEmpty emptyTitle="Nothing here" emptyDescription="Add something." />
    );

    expect(screen.getByText('Nothing here')).not.toBeNull();
    expect(screen.getByText('Add something.')).not.toBeNull();
  });

  it('renders children when there is nothing to report', () => {
    render(
      <QueryState>
        <p>content</p>
      </QueryState>
    );

    expect(screen.getByText('content')).not.toBeNull();
  });
});

describe('InlineError', () => {
  it('shows a dismissible message', () => {
    const onDismiss = vi.fn();

    render(<InlineError message="Save failed" onDismiss={onDismiss} />);

    expect(screen.getByRole('alert').textContent).toContain('Save failed');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss error' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
