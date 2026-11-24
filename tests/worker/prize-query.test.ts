import { expect, it } from 'vitest';
import type { Prize } from '../../shared/prizes';
import { validatePrizeFields } from '../../shared/prizes';
import { blockedReason, filterChoices, parsePrizeQuery, selectPrizes, storeName } from '../../src/features/prizes/prize-query';

const prize = (name: string, cost: number, extra: Partial<Prize> = {}): Prize => ({
  id: name, name, cost, oneTime: false, link: null, imageUrl: null, archived: false, revision: 1,
  createdAt: '2026-11-0' + cost % 10, ...extra,
});
const catalog = [
  prize('Bike', 9, { oneTime: true, link: 'https://shopee.co.id/x' }),
  prize('ice cream', 2),
  prize('Lego', 5, { oneTime: true, archived: true }),
  prize('Movie night', 5),
];
const names = (query: Record<string, unknown>) => selectPrizes(catalog, parsePrizeQuery(query)).map(p => p.name);

it('shows active prizes by cost, then name, by default', () => {
  expect(names({})).toEqual(['ice cream', 'Movie night', 'Bike']);
});

it('searches names ignoring case and combines filters', () => {
  expect(names({ q: 'MOV' })).toEqual(['Movie night']);
  expect(names({ status: 'all', type: 'one-time' })).toEqual(['Lego', 'Bike']);
  expect(names({ status: 'archived' })).toEqual(['Lego']);
  expect(names({ link: 'with' })).toEqual(['Bike']);
  expect(names({ link: 'without', q: 'i' })).toEqual(['ice cream', 'Movie night']);
});

it('orders by cost, name and newest', () => {
  expect(names({ sort: 'cost-desc' })).toEqual(['Bike', 'Movie night', 'ice cream']);
  expect(names({ sort: 'name-asc' })).toEqual(['Bike', 'ice cream', 'Movie night']);
  expect(names({ sort: 'name-desc' })).toEqual(['Movie night', 'ice cream', 'Bike']);
  expect(names({ sort: 'newest' })).toEqual(['Bike', 'Movie night', 'ice cream']);
});

it('drops unknown and default search params', () => {
  expect(parsePrizeQuery({ status: 'active', sort: 'cost-asc', type: 'weird', q: '  ', extra: 1 })).toEqual({});
  expect(parsePrizeQuery({ status: 'all', sort: 'newest', q: 'lego' })).toEqual({ status: 'all', sort: 'newest', q: 'lego' });
});

it('names the store from a link', () => {
  expect(storeName('https://shopee.co.id/Lego-i.1.2')).toBe('Shopee');
  expect(storeName('https://id.shp.ee/abc')).toBe('Shopee');
  expect(storeName('https://www.tokopedia.com/x')).toBe('tokopedia.com');
});

it('normalizes prize fields and rejects non-https links', () => {
  expect(validatePrizeFields({ name: ' Lego ', cost: 3, oneTime: true, link: ' ', imageUrl: '' }))
    .toEqual({ fields: { name: 'Lego', cost: 3, oneTime: true, link: null, imageUrl: null, archived: false } });
  expect(validatePrizeFields({ name: 'Lego', cost: 3, oneTime: true, link: 'ftp://x' })).toHaveProperty('error');
});

it('narrows the redeem picker by name and by what the child can redeem now', () => {
  const choices = [
    { id: 'a', name: 'Kite', cost: 4, oneTime: true, imageUrl: null, redeemed: true },
    { id: 'b', name: 'Ice cream', cost: 3, oneTime: false, imageUrl: null, redeemed: false },
    { id: 'c', name: 'Bike', cost: 50, oneTime: false, imageUrl: null, redeemed: false },
  ];
  expect(blockedReason(choices[0], 10)).toBe('Already redeemed');
  expect(blockedReason(choices[2], 49)).toBe('Needs 1 more star');
  expect(blockedReason(choices[2], -5)).toBe('Needs 50 more stars');
  expect(filterChoices(choices, 10, '', true).map(c => c.id)).toEqual(['b']);
  expect(filterChoices(choices, 10, 'I', false).map(c => c.id)).toEqual(['a', 'b', 'c']);
  expect(filterChoices(choices, 10, 'bik', false).map(c => c.id)).toEqual(['c']);
});
