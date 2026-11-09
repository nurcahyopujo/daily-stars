import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { loadSession, type SessionState } from './session';
import './parent-access.css';

export function ParentAccess() {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let controller: AbortController;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      setSession({ status: 'loading' });
      loadSession(signal).then((result) => {
        if (!signal.aborted) setSession(result);
      }).catch(() => {
        if (!signal.aborted) setSession({ status: 'unavailable' });
      });
    };
    const resume = () => { if (document.visibilityState === 'visible') load(); };
    const hide = () => {
      controller.abort();
      // Remove identity before the browser snapshots a page for history restoration.
      flushSync(() => setSession({ status: 'loading' }));
    };
    load();
    window.addEventListener('pageshow', load);
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', resume);
    return () => {
      controller.abort();
      window.removeEventListener('pageshow', load);
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [attempt]);

  const signOut = () => {
    flushSync(() => setSession({ status: 'loading' }));
    window.location.assign('/cdn-cgi/access/logout');
  };

  return (
    <div className="empty-state parent-access" aria-live="polite" aria-busy={session.status === 'loading'}>
      <span className="empty-star" aria-hidden="true">☆</span>
      {session.status === 'loading' && <p role="status">Checking parent access…</p>}
      {session.status === 'signed-in' && <>
        <h2>You’re signed in</h2>
        <p className="parent-access-email">{session.parent.email}</p>
        <p>Today: <time dateTime={session.parent.today}>{session.parent.today}</time> · Jakarta</p>
        <p>Child profiles and routines are coming next.</p>
        <button type="button" onClick={signOut}>Sign out</button>
      </>}
      {session.status === 'sign-in-required' && <>
        <h2>Sign in to continue</h2>
        <p>Use your approved parent email to open Daily Stars.</p>
        <a className="parent-access-button" href="/">Sign in</a>
      </>}
      {session.status === 'unavailable' && <>
        <h2>We couldn’t check your access</h2>
        <p>Check your connection and try again. You may need to sign in again.</p>
        <div className="parent-access-actions">
          <button type="button" onClick={() => setAttempt(attempt + 1)}>Try again</button>
          <a className="parent-access-button" href="/">Sign in</a>
        </div>
      </>}
    </div>
  );
}
