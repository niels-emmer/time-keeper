import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { AuthGate } from '@/components/AuthGate';

const Home = lazy(() => import('@/pages/Home').then((module) => ({ default: module.Home })));
const Weekly = lazy(() => import('@/pages/Weekly').then((module) => ({ default: module.Weekly })));
const Monthly = lazy(() => import('@/pages/Monthly').then((module) => ({ default: module.Monthly })));
const Settings = lazy(() => import('@/pages/Settings').then((module) => ({ default: module.Settings })));
const Account = lazy(() => import('@/pages/Account').then((module) => ({ default: module.Account })));
const Register = lazy(() => import('@/pages/Register').then((module) => ({ default: module.Register })));

function RouteFallback() {
  return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
}

function LazyRoute({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/*
          Invite acceptance sits outside `AuthGate` on purpose: whoever opens an
          invitation link has no session yet, and the gate would answer with the
          sign-in form instead of the registration form.
        */}
        <Route
          path="register"
          element={
            <LazyRoute>
              <Register />
            </LazyRoute>
          }
        />

        <Route
          element={
            <AuthGate>
              <Layout />
            </AuthGate>
          }
        >
          <Route index element={<LazyRoute><Home /></LazyRoute>} />
          <Route path="weekly" element={<LazyRoute><Weekly /></LazyRoute>} />
          <Route path="monthly" element={<LazyRoute><Monthly /></LazyRoute>} />
          <Route path="settings" element={<LazyRoute><Settings /></LazyRoute>} />
          <Route path="account" element={<LazyRoute><Account /></LazyRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
