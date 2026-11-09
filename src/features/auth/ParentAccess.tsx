import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { loadSession, type SessionState } from './session';
import './parent-access.css';
import { ChildProfiles } from '../children/ChildProfiles';
import { clearChildSave, resumeChildSave, useChildSave } from '../children/requests';

const pages = [
  { id: 'home', label: 'Home', path: '/' },
  { id: 'children', label: 'Manage children', path: '/children' },
  { id: 'profile', label: 'Profile', path: '/profile' },
] as const;

function currentPage() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/home') return 'home';
  return pages.find((page) => page.path === path)?.id ?? 'not-found';
}

export function ParentAccess() {
  const [session, setSession] = useState<SessionState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [menu, setMenu] = useState(currentPage);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigation = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const lastEmail = useRef<string | null>(null);
  const childSave = useChildSave();
  const saveLocked = ['saving', 'uncertain', 'conflict'].includes(childSave.status);
  const signInPath = window.location.pathname + window.location.search;

  useEffect(() => {
    const syncPage = () => { setMenu(currentPage()); setMenuOpen(false); };
    window.addEventListener('popstate', syncPage);
    return () => window.removeEventListener('popstate', syncPage);
  }, []);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navigation.current?.contains(event.target) && navigation.current) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);

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
            if (lastEmail.current && lastEmail.current !== result.parent.email) clearChildSave();
            resumeChildSave();
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
    clearChildSave();
    flushSync(() => setSession({ status: 'loading' }));
    window.location.assign('/cdn-cgi/access/logout');
  };
  const sessionExpired = useCallback(() => setSession({ status: 'sign-in-required' }), []);

  return (
    <>
    <header className="parent-topbar">
      <div className="brand"><span className="star" aria-hidden="true">✦</span><span>Daily Stars</span></div>
      <div className="parent-menu" ref={navigation} onKeyDown={(event) => {
        if (event.key === 'Escape' && menuOpen) {
          event.preventDefault();
          setMenuOpen(false);
          menuButton.current?.focus();
        }
      }}>
        <button ref={menuButton} className="parent-menu-toggle" type="button" aria-label="Main menu"
          aria-expanded={menuOpen} aria-controls="main-menu" onClick={() => setMenuOpen(!menuOpen)}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <nav id="main-menu" className="parent-navigation" aria-label="Main menu" hidden={!menuOpen}>
          {pages.map((page) =>
            <a key={page.id} href={page.path} aria-current={menu === page.id ? 'page' : undefined}
              aria-disabled={saveLocked || (page.id === 'children' && session.status !== 'signed-in')}
              onClick={(event) => {
                if (saveLocked || (page.id === 'children' && session.status !== 'signed-in')) {
                  event.preventDefault();
                  return;
                }
                if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                if (window.location.pathname + window.location.search + window.location.hash !== page.path) {
                  window.history.pushState(null, '', page.path);
                }
                setMenu(currentPage());
                setMenuOpen(false);
                menuButton.current?.focus();
                window.scrollTo(0, 0);
              }}>{page.label}</a>)}
        </nav>
      </div>
    </header>
    {(menu === 'profile' || session.status !== 'signed-in') && <section aria-label="Profile">
      <div className="empty-state parent-access" aria-live="polite" aria-busy={session.status === 'loading'}>
      <span className="empty-star" aria-hidden="true">☆</span>
      {session.status === 'loading' && <p role="status">Checking parent access…</p>}
      {session.status === 'signed-in' && <>
        <h2>You’re signed in</h2>
        <p className="parent-access-email">{session.parent.email}</p>
        <p>Today: <time dateTime={session.parent.today}>{session.parent.today}</time> · Jakarta</p>
        <button type="button" onClick={signOut}>Sign out</button>
      </>}
      {session.status === 'sign-in-required' && <>
        <h2>Sign in to continue</h2>
        <p>Use your approved parent email to open Daily Stars.</p>
        {childSave.status === 'uncertain' && <p>Save not confirmed. Keep this page open to retain its retry key. Reopening the app discards it.</p>}
        <button type="button" onClick={() => setAttempt(attempt + 1)}>Check access</button>
        <a className="parent-access-button" href={signInPath}>Sign in</a>
      </>}
      {session.status === 'unavailable' && <>
        <h2>We couldn’t check your access</h2>
        <p>Check your connection and try again. You may need to sign in again.</p>
        <div className="parent-access-actions">
          <button type="button" onClick={() => setAttempt(attempt + 1)}>Try again</button>
          <a className="parent-access-button" href={signInPath}>Sign in</a>
        </div>
      </>}
    </div>
    </section>}
    {session.status === 'signed-in' && menu === 'home' && <section className="welcome" aria-label="Home">
      <p className="eyebrow">A little progress, every day</p>
      <h1>Small steps.<br />Bright days.</h1>
      <p className="intro">A place for your family’s routines, daily activities, and points.</p>
    </section>}
    {session.status === 'signed-in' && (menu === 'children' || saveLocked) && <ChildProfiles onSessionExpired={sessionExpired} />}
    {session.status === 'signed-in' && menu === 'not-found' && <section aria-label="Page not found">
      <h1>Page not found</h1><p>Choose a page from the main menu.</p>
    </section>}
    </>
  );
}
