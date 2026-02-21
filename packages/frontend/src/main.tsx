import React, { useState, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { AuthContext } from './lib/authContext.ts';
import { AuthError } from './lib/api.ts';
import './index.css';

function Root() {
  const [sessionExpired, setSessionExpired] = useState(false);

  const markSessionExpired = useCallback(() => setSessionExpired(true), []);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            retry: (failureCount, error) => {
              // Never retry auth failures — the session is gone
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
        queryCache: undefined,
      })
  );

  // Attach a global query-level observer for auth errors
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

  return (
    <AuthContext.Provider value={{ sessionExpired, markSessionExpired }}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
