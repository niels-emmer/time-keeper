import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Home } from '@/pages/Home';
import { Weekly } from '@/pages/Weekly';
import { Settings } from '@/pages/Settings';
import { SessionExpiredOverlay } from '@/components/SessionExpiredOverlay';
import { useAuthContext } from '@/lib/authContext';

export default function App() {
  const { sessionExpired } = useAuthContext();

  return (
    <BrowserRouter>
      {sessionExpired && <SessionExpiredOverlay />}
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="weekly" element={<Weekly />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
