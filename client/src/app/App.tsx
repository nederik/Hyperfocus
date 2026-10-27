import { Navigate, Route, Routes } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { SetupStatus } from '@hyperfocus/shared';
import { api, ApiError } from '../lib/api';
import { Login } from './Login';
import { LoadingScreen } from './LoadingScreen';
import { Shelf } from './Shelf';
import { BookEditor } from './BookEditor';
import { Reader } from './Reader';
import { EyeComfort } from './EyeComfort';
import { LeaveGuard } from './LeaveGuard';
import { SecureGate } from './SecureGate';

export const ME_KEY = ['me'];
export const useMe = () =>
  useQuery({ queryKey: ME_KEY, queryFn: () => api.get<{ username: string; displayName: string }>('/api/me'), retry: false });

/** Hyperfocus: the sign-in screen (or first-start setup) when signed out; otherwise the shelf and the editor. */
export function HyperfocusApp() {
  return (
    <>
      <EyeComfort />
      <LeaveGuard />
      <Body />
    </>
  );
}

function Body() {
  const me = useMe();
  const signedOut = me.error instanceof ApiError && me.error.status === 401;
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => api.get<SetupStatus>('/api/status'), enabled: signedOut });
  if (me.isLoading || (signedOut && status.isLoading)) return <LoadingScreen show />;
  if (signedOut) return <Login setup={status.data?.needsSetup ?? false} tokenRequired={status.data?.tokenRequired ?? false} />;
  if (me.error) return <p className="empty-state">Hyperfocus could not be opened: {(me.error as Error).message}</p>;
  return (
    <SecureGate>
      <Routes>
        <Route path="/" element={<Shelf />} />
        <Route path="/book/:id" element={<BookEditor />} />
        <Route path="/book/:id/read" element={<Reader />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SecureGate>
  );
}
