import type { Prize } from '../../../shared/prizes';

// The /prizes view selection: search, filters and sort, kept in URL search params.
// The whole catalog is small, so the list is narrowed and ordered in the browser.

export const STATUS = ['active', 'archived', 'all'] as const;
export const TYPE = ['all', 'one-time', 'repeatable'] as const;
export const LINK = ['all', 'with', 'without'] as const;
export const SORT = ['cost-asc', 'cost-desc', 'name-asc', 'name-desc', 'newest'] as const;

export type PrizeQuery = {
  q?: string;
  status?: typeof STATUS[number];
  type?: typeof TYPE[number];
  link?: typeof LINK[number];
  sort?: typeof SORT[number];
};

const pick = <T extends string>(options: readonly T[], value: unknown, fallback: T): T | undefined =>
  typeof value === 'string' && (options as readonly string[]).includes(value) && value !== fallback ? value as T : undefined;

/** Validate raw search params, dropping defaults so the URL stays clean. */
export function parsePrizeQuery(search: Record<string, unknown>): PrizeQuery {
  const query: PrizeQuery = {
    q: typeof search.q === 'string' && search.q.trim() ? search.q.slice(0, 160) : undefined,
    status: pick(STATUS, search.status, 'active'),
    type: pick(TYPE, search.type, 'all'),
    link: pick(LINK, search.link, 'all'),
    sort: pick(SORT, search.sort, 'cost-asc'),
  };
  return Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) as PrizeQuery;
}

const byName = (a: Prize, b: Prize) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

export function selectPrizes(prizes: Prize[], query: PrizeQuery): Prize[] {
  const text = query.q?.trim().toLocaleLowerCase();
  const status = query.status ?? 'active';
  const type = query.type ?? 'all';
  const link = query.link ?? 'all';
  const filtered = prizes.filter(prize =>
    (!text || prize.name.toLocaleLowerCase().includes(text))
    && (status === 'all' || prize.archived === (status === 'archived'))
    && (type === 'all' || prize.oneTime === (type === 'one-time'))
    && (link === 'all' || Boolean(prize.link) === (link === 'with')));
  const order: Record<typeof SORT[number], (a: Prize, b: Prize) => number> = {
    'cost-asc': (a, b) => a.cost - b.cost || byName(a, b),
    'cost-desc': (a, b) => b.cost - a.cost || byName(a, b),
    'name-asc': byName,
    'name-desc': (a, b) => byName(b, a),
    newest: (a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b),
  };
  return filtered.sort(order[query.sort ?? 'cost-asc']);
}

/** A prize's store, named from its link, for the "View on …" action. */
export function storeName(link: string): string {
  const host = new URL(link).hostname.replace(/^www\./, '');
  if (/(^|\.)shopee\.|(^|\.)shp\.ee$/.test(host)) return 'Shopee';
  return host;
}

// The list's last view selection, so returning from an editor keeps the parent's
// search and filters. Memory only, like the rest of the session's view state.
let lastQuery: PrizeQuery = {};
export const rememberPrizeQuery = (query: PrizeQuery) => { lastQuery = query; };
export const lastPrizeQuery = (): PrizeQuery => lastQuery;
