import { createContext, useContext } from 'react';

export interface AppStatusContextValue {
  isOnline: boolean;
  recentlyReconnected: boolean;
  lastConnectionChangeAt: number | null;
  updateAvailable: boolean;
  applyingUpdate: boolean;
  applyUpdate: () => void;
  dismissUpdate: () => void;
}

export const AppStatusContext = createContext<AppStatusContextValue | null>(null);

export function useAppStatus() {
  const value = useContext(AppStatusContext);
  if (!value) {
    throw new Error('useAppStatus must be used within AppStatusContext.Provider');
  }
  return value;
}
