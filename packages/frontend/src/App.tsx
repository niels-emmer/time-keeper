import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { AuthGate } from '@/components/AuthGate';
// Imported statically on purpose: `AuthGate` already pulls the Login card into
// the main chunk, so a lazy route here only produced a "dynamically imported,
// also statically imported" warning without splitting anything.
import { LoginPage } from '@/pages/Login';

const Home = lazy(() => import('@/pages/Home').then((module) => ({ default: module.Home })));
const Weekly = lazy(() => import('@/pages/Weekly').then((module) => ({ default: module.Weekly })));
const Monthly = lazy(() => import('@/pages/Monthly').then((module) => ({ default: module.Monthly })));
const Settings = lazy(() => import('@/pages/Settings').then((module) => ({ default: module.Settings })));
const Account = lazy(() => import('@/pages/Account').then((module) => ({ default: module.Account })));
const Register = lazy(() => import('@/pages/Register').then((module) => ({ default: module.Register })));
const Reset = lazy(() => import('@/pages/Reset').then((module) => ({ default: module.Reset })));

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
          The documented sign-in URL (README and docs/operations/local-dev.md
          both say to open /login). It renders the same form `AuthGate` shows in
          place of a protected route, and sends an already-signed-in visitor to
          the app. Without this route /login was a blank page.
        */}
        <Route path="login" element={<LoginPage />} />

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

        {/*
          Password reset / first-password redemption sits outside `AuthGate` for
          the same reason as `Register`: the holder of a reset code has no
          session yet. This is also the page a newly created or migrated account
          uses to clear `must_set_password`.
        */}
        <Route
          path="reset"
          element={
            <LazyRoute>
              <Reset />
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
