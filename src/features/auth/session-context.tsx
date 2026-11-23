import { createContext, useContext, type ReactNode } from 'react';
import type { ParentSession, SessionState } from './session';

export type SessionContextValue = {
  session: SessionState;
  parent: ParentSession | null;
  signOut: () => void;
  sessionExpired: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ value, children }: { value: SessionContextValue; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within a SessionProvider.');
  return value;
}
