import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExternalLink, Plus, Search } from "lucide-react";
import { Link } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { Prize } from '../../../shared/prizes';
import { RequestError } from '../children/requests';
import { useResource } from '../children/use-resource';
import { GoldStar } from '../children/StarBalance';
import { PrizeImage } from './PrizeImage';
import { rememberPrizeQuery, selectPrizes, storeName, type PrizeQuery } from './prize-query';
import { usePrizeSave } from './prize-requests';
import '../children/child-profiles.css';
import './prize-catalog.css';

export function PrizeCost({ cost }: { cost: number }) {
  return <span className="prizes-cost" aria-label={`Costs ${cost} ${cost === 1 ? 'star' : 'stars'}`}>
    <GoldStar size={15} reduce animated={false} />
    <span className="prizes-cost-value" aria-hidden="true">{cost}</span>
  </span>;
}

function PrizeCard({ prize }: { prize: Prize }) {
  return <li className={`catalog-card${prize.archived ? ' is-archived' : ''}`}>
    <PrizeImage src={prize.imageUrl} size="card" />
    <div className="catalog-card-body">
      <h2 className="catalog-card-name">
        <Link to="/prizes/$prizeId" params={{ prizeId: prize.id }} className="catalog-card-open">{prize.name}</Link>
      </h2>
      <div className="catalog-card-meta">
        <PrizeCost cost={prize.cost} />
        {prize.oneTime && <span className="catalog-tag is-once">One-time</span>}
        {prize.archived && <span className="catalog-tag is-archived">Archived</span>}
      </div>
      {prize.link && <a className="catalog-card-store" href={prize.link} target="_blank" rel="noopener noreferrer">
        View on {storeName(prize.link)}<ExternalLink size={13} aria-hidden="true" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>}
    </div>
  </li>;
}

// The household prize catalog: searchable, filterable, ordered cards. Each card opens
// its editor page; a just-finished save surfaces its confirmation here.
export function PrizeList({ query, onQueryChange, onSessionExpired }: {
  query: PrizeQuery; onQueryChange: (next: PrizeQuery) => void; onSessionExpired: () => void;
}) {
  const onError = useCallback((error: unknown) => {
    if (error instanceof RequestError && error.status === 401) onSessionExpired();
  }, [onSessionExpired]);
  const catalog = useResource<{ prizes: Prize[] }>('/api/prizes', { onError });
  const save = usePrizeSave();
  rememberPrizeQuery(query);
  const saved = save.status === 'success' ? save.result : null;
  const shown = catalog.data ? selectPrizes(catalog.data.prizes, query) : [];
  const set = (patch: Partial<PrizeQuery>) => onQueryChange({ ...query, ...patch });
  const filtered = Boolean(query.q || query.type || query.link || query.status);

  return <section className="child-profiles templates-list catalog" aria-labelledby="prizes-title" aria-busy={catalog.loading}>
    <div className="child-profiles-heading templates-heading">
      <div>
        <h1 id="prizes-title">Prizes</h1>
        <p className="templates-intro">Rewards any child can spend stars on. Pick one when redeeming on a child’s Prizes page.</p>
      </div>
      <Link to="/prizes/new" className="templates-create">
        <Plus size={17} aria-hidden="true" /><span>Add prize</span>
      </Link>
    </div>

    {saved && <p role="status" className="templates-saved">Saved {saved.name}{saved.archived ? ' · Archived' : ''}.</p>}

    <form className="catalog-tools" role="search" aria-label="Find prizes" onSubmit={event => event.preventDefault()}>
      <label className="catalog-search">
        <span className="sr-only">Search prizes</span>
        <Search size={17} aria-hidden="true" />
        <Input type="search" placeholder="Search prizes" value={query.q ?? ''} maxLength={160}
          onChange={event => set({ q: event.target.value || undefined })} />
      </label>
      <div className="catalog-filters">
        <label>Status
          <select value={query.status ?? 'active'} onChange={event => set({ status: event.target.value === 'active' ? undefined : event.target.value as PrizeQuery['status'] })}>
            <option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option>
          </select>
        </label>
        <label>Type
          <select value={query.type ?? 'all'} onChange={event => set({ type: event.target.value === 'all' ? undefined : event.target.value as PrizeQuery['type'] })}>
            <option value="all">All</option><option value="one-time">One-time</option><option value="repeatable">Repeatable</option>
          </select>
        </label>
        <label>Link
          <select value={query.link ?? 'all'} onChange={event => set({ link: event.target.value === 'all' ? undefined : event.target.value as PrizeQuery['link'] })}>
            <option value="all">All</option><option value="with">Has link</option><option value="without">No link</option>
          </select>
        </label>
        <label>Sort
          <select value={query.sort ?? 'cost-asc'} onChange={event => set({ sort: event.target.value === 'cost-asc' ? undefined : event.target.value as PrizeQuery['sort'] })}>
            <option value="cost-asc">Cost: low to high</option><option value="cost-desc">Cost: high to low</option>
            <option value="name-asc">Name: A–Z</option><option value="name-desc">Name: Z–A</option><option value="newest">Newest</option>
          </select>
        </label>
      </div>
    </form>

    {catalog.loading && <p role="status" className="tpl-loading">Loading prizes…</p>}
    {catalog.error !== null && !(catalog.error instanceof RequestError && catalog.error.status === 401) && <div role="alert" className="tpl-loaderror">
      <p>Couldn’t load prizes. Check your connection and try again.</p>
      <Button type="button" onClick={() => catalog.reload()}>Try again</Button>
    </div>}

    {catalog.data && (catalog.data.prizes.length === 0
      ? <div className="templates-empty">
          <p className="templates-empty-title">No prizes yet</p>
          <p>Add the rewards your children can save their stars for.</p>
          <Link to="/prizes/new" className="templates-create templates-empty-create">
            <Plus size={16} aria-hidden="true" /><span>Add prize</span>
          </Link>
        </div>
      : <>
          <p className="catalog-count" role="status">{shown.length} {shown.length === 1 ? 'prize' : 'prizes'}</p>
          {shown.length === 0
            ? <div className="templates-empty">
                <p className="templates-empty-title">No matching prizes</p>
                <p>Try another search or filter.</p>
                {filtered && <Button type="button" className="catalog-clear" onClick={() => onQueryChange(query.sort ? { sort: query.sort } : {})}>Clear search and filters</Button>}
              </div>
            : <ul className="catalog-cards">{shown.map(prize => <PrizeCard key={prize.id} prize={prize} />)}</ul>}
        </>)}
  </section>;
}
