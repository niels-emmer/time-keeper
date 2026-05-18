import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { SessionExpiredOverlay } from '@/components/SessionExpiredOverlay';
import { useAuthContext } from '@/lib/authContext';

const Home = lazy(() => import('@/pages/Home').then((module) => ({ default: module.Home })));
const Weekly = lazy(() => import('@/pages/Weekly').then((module) => ({ default: module.Weekly })));
const Monthly = lazy(() => import('@/pages/Monthly').then((module) => ({ default: module.Monthly })));
const Settings = lazy(() => import('@/pages/Settings').then((module) => ({ default: module.Settings })));

function RouteFallback() {
  return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export default function App() {
  const { sessionExpired } = useAuthContext();

  return (
    <BrowserRouter>
      {sessionExpired && <SessionExpiredOverlay />}
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<LazyRoute><Home /></LazyRoute>} />
          <Route path="weekly" element={<LazyRoute><Weekly /></LazyRoute>} />
          <Route path="monthly" element={<LazyRoute><Monthly /></LazyRoute>} />
          <Route path="settings" element={<LazyRoute><Settings /></LazyRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
