import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { loadSession, type SessionState } from './session';
import { SessionProvider } from './session-context';
import './parent-access.css';
import { ChildProfiles } from '../children/ChildProfiles';
import { RuleSettings } from '../children/RuleSettings';
import { clearPrizeSaves } from '../children/Prizes';
import { clearScoreSaves } from '../children/ScoreDay';
import { clearChildSave, clearRuleSave, resumeChildSave, resumeRuleSave, useChildSave, useRuleSave } from '../children/requests';

const pages = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'children', label: 'Manage children', path: '/children' },
  { id: 'templates', label: 'Templates & assignments', path: '/templates' },
  { id: 'profile', label: 'Profile', path: '/profile' },
] as const;

function activePage(pathname: string) {
  if (pathname === '/' || pathname === '/home') return 'home';
  if (pathname.startsWith('/children')) return 'children';
  if (pathname.startsWith('/templates')) return 'templates';
  if (pathname.startsWith('/profile')) return 'profile';
  return 'not-found';
}

export function RootShell() {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const lastEmail = useRef<string | null>(null);
  const childSave = useChildSave();
  const ruleSave = useRuleSave();
  const childSaveLocked = ['saving', 'uncertain', 'conflict'].includes(childSave.status);
  const ruleSaveLocked = ruleSave.status === 'saving' || ruleSave.status === 'uncertain';
  const saveLocked = childSaveLocked || ruleSaveLocked;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const signInPath = useRouterState({ select: (state) => state.location.href });
  const menu = activePage(pathname);
  // While a save is locked, show that feature's recovery UI. Keep the live route mounted when it
  // already is that feature (so an in-progress edit survives); override it only after navigating away.
  const lockedPage = childSaveLocked ? 'children' : ruleSaveLocked ? 'templates' : null;

  // Close the menu when the route changes (menu links, back/forward, or in-app navigation).
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  useEffect(() => {
    let controller: AbortController;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      setSession({ status: 'loading' });
      loadSession(signal).then((result) => {
        if (!signal.aborted) {
          if (result.status === 'signed-in') {
            if (lastEmail.current && lastEmail.current !== result.parent.email) { clearChildSave(); clearScoreSaves(); clearPrizeSaves(); clearRuleSave(); }
            resumeChildSave();
            resumeRuleSave();
            lastEmail.current = result.parent.email;
          }
          setSession(result);
        }
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
    clearScoreSaves(); clearPrizeSaves();
    clearChildSave();
    clearRuleSave();
    flushSync(() => setSession({ status: 'loading' }));
    window.location.assign('/cdn-cgi/access/logout');
  };
  const sessionExpired = useCallback(() => setSession({ status: 'sign-in-required' }), []);

  return (
    <SessionProvider value={{ session, parent: session.status === 'signed-in' ? session.parent : null, signOut, sessionExpired }}>
    <main>
    <header className="parent-topbar">
      <div className="brand"><span className="star" aria-hidden="true">✦</span><span>Daily Stars</span></div>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger render={<Button ref={menuButton} className="parent-menu-toggle" type="button" aria-label="Main menu" />}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="parent-navigation">
        <nav aria-label="Main menu">
          {pages.map((page) => {
            const disabled = saveLocked || ((page.id === 'children' || page.id === 'templates') && session.status !== 'signed-in');
            const current = menu === page.id ? 'page' : undefined;
            if (disabled) {
              return <a key={page.id} href={page.path} aria-current={current} aria-disabled="true"
                onClick={(event) => event.preventDefault()}>{page.label}</a>;
            }
            return <Link key={page.id} to={page.path} aria-current={current}
              onClick={() => { setMenuOpen(false); menuButton.current?.focus(); window.scrollTo(0, 0); }}>{page.label}</Link>;
          })}
        </nav>
        </PopoverContent>
      </Popover>
    </header>
    {session.status !== 'signed-in'
      ? <section aria-label="Profile">
          <div className="empty-state parent-access" aria-live="polite" aria-busy={session.status === 'loading'}>
          <span className="empty-star" aria-hidden="true">☆</span>
          {session.status === 'loading' && <p role="status">Checking parent access…</p>}
          {session.status === 'sign-in-required' && <>
            <h2>Sign in to continue</h2>
            <p>Use your approved parent email to open Daily Stars.</p>
            {(childSave.status === 'uncertain' || ruleSave.status === 'uncertain') && <p>Save not confirmed. Keep this page open to retain its retry key. Reopening the app discards it.</p>}
            <Button type="button" onClick={() => setAttempt(attempt + 1)}>Check access</Button>
            <a className="parent-access-button" href={signInPath}>Sign in</a>
          </>}
          {session.status === 'unavailable' && <>
            <h2>We couldn’t check your access</h2>
            <p>Check your connection and try again. You may need to sign in again.</p>
            <div className="parent-access-actions">
              <Button type="button" onClick={() => setAttempt(attempt + 1)}>Try again</Button>
              <a className="parent-access-button" href={signInPath}>Sign in</a>
            </div>
          </>}
          </div>
        </section>
      : lockedPage && menu !== lockedPage
        ? (lockedPage === 'children'
            ? <ChildProfiles onSessionExpired={sessionExpired} />
            : <RuleSettings onSessionExpired={sessionExpired} />)
      : <Outlet />}
    </main>
    <footer>Every effort counts.</footer>
    </SessionProvider>
  );
}
