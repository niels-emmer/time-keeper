import { useEffect, useRef, useState } from 'react';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [recentlyReconnected, setRecentlyReconnected] = useState(false);
  const [lastConnectionChangeAt, setLastConnectionChangeAt] = useState<number | null>(null);
  const wasOfflineRef = useRef(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setLastConnectionChangeAt(Date.now());
      if (wasOfflineRef.current) {
        setRecentlyReconnected(true);
      }
      wasOfflineRef.current = false;
    };

    const handleOffline = () => {
      setIsOnline(false);
      setLastConnectionChangeAt(Date.now());
      setRecentlyReconnected(false);
      wasOfflineRef.current = true;
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!recentlyReconnected) return;
    const timeout = window.setTimeout(() => setRecentlyReconnected(false), 4000);
    return () => window.clearTimeout(timeout);
  }, [recentlyReconnected]);

  return { isOnline, recentlyReconnected, lastConnectionChangeAt };
}
