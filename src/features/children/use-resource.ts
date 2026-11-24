import { useCallback, useEffect, useRef, useState } from 'react';
import { requestJson } from './requests';

// ─── Resource ─────────────────────────────────────────────────────────────────
// The server-truth read every screen used to re-cut by hand: an AbortController
// fetch, the "ignore the response if the path changed" stale guard, a reload that
// blanks the view, and a reconcile that pulls fresh data in place without blanking
// (the seam a Save flow calls after a confirmed mutation). `mutate` lets a screen
// apply an optimistic guess over the fetched value. Error wording and 401 routing
// stay with the screen via `onError`. See GLOSSARY.md › Save flow.

export type Resource<T> = {
  data: T | null;
  error: unknown | null;
  loading: boolean;
  reload: () => void;
  /** Refetch in place (no blanking); ignores a response the path has outrun. Returns the fresh value. */
  reconcile: () => Promise<T | null>;
  /** Apply an optimistic change over the current value (e.g. before a save settles). */
  mutate: (updater: (previous: T | null) => T | null) => void;
};

export function useResource<T>(path: string | null, options?: { onError?: (error: unknown) => void }): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const [reloadCount, setReloadCount] = useState(0);
  const pathRef = useRef(path);
  pathRef.current = path;
  const onError = useRef(options?.onError);
  onError.current = options?.onError;

  useEffect(() => {
    if (path === null) { setData(null); setError(null); return; }
    const controller = new AbortController();
    setData(null);
    setError(null);
    requestJson<T>(path, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setData(value); })
      .catch((failure) => {
        if (controller.signal.aborted) return;
        setError(failure);
        onError.current?.(failure);
      });
    return () => controller.abort();
  }, [path, reloadCount]);

  const reload = useCallback(() => { setError(null); setReloadCount((count) => count + 1); }, []);

  const reconcile = useCallback(async (): Promise<T | null> => {
    const at = pathRef.current;
    if (at === null) return null;
    try {
      const fresh = await requestJson<T>(at);
      if (pathRef.current === at) { setData(fresh); return fresh; }
    } catch {
      // Offline or server error: keep what's on screen. The next action or a
      // manual reload will resync.
    }
    return null;
  }, []);

  const loading = path !== null && data === null && error === null;
  return { data, error, loading, reload, reconcile, mutate: setData };
}
