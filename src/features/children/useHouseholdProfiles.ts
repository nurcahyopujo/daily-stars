import { useCallback, useEffect, useRef, useState } from 'react';
import type { Child, TemplateSummary } from '../../../shared/profiles';
import { requestJson, RequestError } from './requests';

type Profiles = { today: string; children: (Child & { total?: number; balance?: number; todayPoints?: number })[] };

export function useHouseholdProfiles(onSessionExpired: () => void) {
  const [data, setData] = useState<Profiles | null>(null);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError(false);
    try {
      const [profiles, routines] = await Promise.all([
        requestJson<Profiles>('/api/children?includeArchived=true', { signal: current.signal }),
        requestJson<{ templates: TemplateSummary[] }>('/api/templates', { signal: current.signal }),
      ]);
      if (!current.signal.aborted) { setData(profiles); setTemplates(routines.templates); }
    } catch (failure) {
      if (!current.signal.aborted) {
        if (failure instanceof RequestError && failure.status === 401) onSessionExpired();
        else setError(true);
      }
    } finally { if (!current.signal.aborted) setLoading(false); }
  }, [onSessionExpired]);

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  return { data, templates, loading, error, load };
}
