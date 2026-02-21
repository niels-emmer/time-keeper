import { createContext, useContext } from 'react';

export interface AuthContextValue {
  sessionExpired: boolean;
  markSessionExpired: () => void;
}

export const AuthContext = createContext<AuthContextValue>({
  sessionExpired: false,
  markSessionExpired: () => {},
});

export function useAuthContext() {
  return useContext(AuthContext);
}
