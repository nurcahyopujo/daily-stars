export type ParentSession = { email: string; today: string; timezone: 'Asia/Jakarta' };

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed-in'; parent: ParentSession }
  | { status: 'sign-in-required' }
  | { status: 'unavailable' };

export async function loadSession(signal: AbortSignal): Promise<SessionState> {
  const response = await fetch('/api/me', {
    credentials: 'same-origin', cache: 'no-store', redirect: 'manual', signal,
  });
  if (response.type === 'opaqueredirect' || response.status === 401 || response.status === 403
    || response.redirected || (response.ok && !response.headers.get('Content-Type')?.includes('application/json'))) {
    return { status: 'sign-in-required' };
  }
  if (!response.ok) return { status: 'unavailable' };
  const parent = await response.json();
  if (typeof parent?.email !== 'string' || !parent.email.trim()
    || typeof parent?.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parent.today)
    || parent?.timezone !== 'Asia/Jakarta') {
    return { status: 'unavailable' };
  }
  return { status: 'signed-in', parent };
}
