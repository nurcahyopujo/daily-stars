import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Plus, Search } from "lucide-react";
import { Link } from '@tanstack/react-router';
import { useCallback } from 'react';
import type { Prize } from '../../../shared/prizes';
import { RequestError } from '../children/requests';
import { useResource } from '../children/use-resource';
import { GoldStar } from '../children/StarBalance';
import { PrizeImage } from './PrizeImage';
import { LINK, rememberPrizeQuery, selectPrizes, SORT, STATUS, storeName, TYPE, type PrizeQuery } from './prize-query';
import { usePrizeSave } from './prize-requests';
import '../children/child-profiles.css';
import './prize-catalog.css';

export function PrizeCost({ cost }: { cost: number }) {
  return <span className="prizes-cost" aria-label={`Costs ${cost} ${cost === 1 ? 'star' : 'stars'}`}>
    <GoldStar size={15} reduce animated={false} />
    <span className="prizes-cost-value" aria-hidden="true">{cost}</span>
  </span>;
}

export type Option<T extends string> = { value: T; label: string };
const STATUS_OPTIONS: Option<typeof STATUS[number]>[] = [
  { value: 'active', label: 'Active' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }];
const TYPE_OPTIONS: Option<typeof TYPE[number]>[] = [
  { value: 'all', label: 'All' }, { value: 'one-time', label: 'One-time' }, { value: 'repeatable', label: 'Repeatable' }];
const LINK_OPTIONS: Option<typeof LINK[number]>[] = [
  { value: 'all', label: 'All' }, { value: 'with', label: 'Has link' }, { value: 'without', label: 'No link' }];
const SORT_OPTIONS: Option<typeof SORT[number]>[] = [
  { value: 'cost-asc', label: 'Cost: low to high' }, { value: 'cost-desc', label: 'Cost: high to low' },
  { value: 'name-asc', label: 'Name: A–Z' }, { value: 'name-desc', label: 'Name: Z–A' }, { value: 'newest', label: 'Newest' }];

// One labelled filter on the shared shadcn Select; `items` lets the trigger show the label.
export function FilterSelect<T extends string>({ label, options, value, onChange }: {
  label: string; options: Option<T>[]; value: T; onChange: (value: T) => void;
}) {
  return <label>{label}
    <Select items={options} value={value} onValueChange={next => { if (next != null) onChange(next); }}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  </label>;
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
        <FilterSelect label="Status" options={STATUS_OPTIONS} value={query.status ?? 'active'}
          onChange={value => set({ status: value === 'active' ? undefined : value })} />
        <FilterSelect label="Type" options={TYPE_OPTIONS} value={query.type ?? 'all'}
          onChange={value => set({ type: value === 'all' ? undefined : value })} />
        <FilterSelect label="Link" options={LINK_OPTIONS} value={query.link ?? 'all'}
          onChange={value => set({ link: value === 'all' ? undefined : value })} />
        <FilterSelect label="Sort" options={SORT_OPTIONS} value={query.sort ?? 'cost-asc'}
          onChange={value => set({ sort: value === 'cost-asc' ? undefined : value })} />
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
