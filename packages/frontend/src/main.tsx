import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { AuthProvider, useAuthContext } from './lib/authContext';
import { AuthError } from './lib/api';
import { ThemeProvider } from './context/ThemeContext.tsx';
import { AppStatusContext, useAppStatus } from './lib/appStatusContext.tsx';
import { useOnlineStatus } from './hooks/useOnlineStatus.ts';
import { useServiceWorkerUpdate } from './hooks/useServiceWorkerUpdate.ts';
import './index.css';

/**
 * Query client lives inside the auth provider so a 401 can mark the session
 * expired through the same context the AuthGate reads. A 403 is deliberately
 * not an auth error: it is a permission/CSRF answer, surfaced to the caller.
 */
function QueryLayer() {
  const { markSessionExpired } = useAuthContext();
  const { isOnline, recentlyReconnected } = useAppStatus();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: (failureCount, error) => {
              // Never retry auth failures — the session is gone.
              if (error instanceof AuthError) return false;
              return failureCount < 1;
            },
          },
          mutations: {
            onError: (error) => {
              if (error instanceof AuthError) markSessionExpired();
            },
          },
        },
      })
  );

  React.useEffect(() => {
    return queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'error' &&
        event.action.error instanceof AuthError
      ) {
        markSessionExpired();
      }
    });
  }, [queryClient, markSessionExpired]);

  React.useEffect(() => {
    if (!isOnline) return;
    if (!recentlyReconnected) return;
    queryClient.invalidateQueries();
  }, [isOnline, recentlyReconnected, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

function Root() {
  const { updateAvailable, applyingUpdate, applyUpdate, dismissUpdate } = useServiceWorkerUpdate();
  const { isOnline, recentlyReconnected, lastConnectionChangeAt } = useOnlineStatus();

  return (
    <ThemeProvider>
      <AuthProvider>
        <AppStatusContext.Provider
          value={{
            isOnline,
            recentlyReconnected,
            lastConnectionChangeAt,
            updateAvailable,
            applyingUpdate,
            applyUpdate,
            dismissUpdate,
          }}
        >
          <QueryLayer />
        </AppStatusContext.Provider>
      </AuthProvider>
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
