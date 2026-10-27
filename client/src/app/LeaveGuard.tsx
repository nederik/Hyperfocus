import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { toast } from '../lib/toast';
import { flushAll, hasUnsaved } from './autosave';

/**
 * With unsaved changes, moving to another page waits: first it saves, then it moves.
 * If saving fails you stay on the page (autosave retries when the connection is back).
 * The browser's warning for closing/reloading the tab is in autosave.
 */
export function LeaveGuard() {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && hasUnsaved());

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let alive = true;
    void flushAll().then((ok) => {
      if (!alive) return;
      if (ok) blocker.proceed();
      else {
        blocker.reset();
        toast('Your latest changes are not saved yet, so you can’t leave this page. Check your connection and try again.');
      }
    });
    return () => {
      alive = false;
    };
  }, [blocker]);

  return null;
}
