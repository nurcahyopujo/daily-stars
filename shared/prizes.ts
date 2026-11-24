// A household Prize and the rules both ends share. See GLOSSARY.md › Prize and
// docs/adr/0005-prize-catalog.md.

export type Prize = {
  id: string;
  name: string;
  cost: number;
  oneTime: boolean;
  link: string | null;
  imageUrl: string | null;
  archived: boolean;
  revision: number;
  createdAt: string;
};

/** The editable fields of a prize, as a parent submits them. */
export type PrizeFields = Pick<Prize, 'name' | 'cost' | 'oneTime' | 'link' | 'imageUrl' | 'archived'>;

/** A catalog prize as the redeem page sees it for one child. */
export type CatalogChoice = Pick<Prize, 'id' | 'name' | 'cost' | 'oneTime' | 'imageUrl'> & { redeemed: boolean };

export const PRIZE_NAME_MAX = 160;
export const PRIZE_COST_MAX = 99_999;
export const PRIZE_URL_MAX = 2_048;

export function isHttpsUrl(value: string): boolean {
  if (value.length > PRIZE_URL_MAX) return false;
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

/**
 * Validate and normalize submitted prize fields. Returns the clean fields, or a
 * parent-facing message describing the first problem.
 */
export function validatePrizeFields(input: Record<string, unknown>): { fields: PrizeFields } | { error: string } {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > PRIZE_NAME_MAX) return { error: `Enter a prize name of 1–${PRIZE_NAME_MAX} characters.` };
  const cost = input.cost;
  if (typeof cost !== 'number' || !Number.isSafeInteger(cost) || cost < 1 || cost > PRIZE_COST_MAX) {
    return { error: 'Enter a cost of at least 1 whole star.' };
  }
  if (typeof input.oneTime !== 'boolean') return { error: 'Choose one-time or repeatable.' };
  const url = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
  const link = url(input.link);
  const imageUrl = url(input.imageUrl);
  if ((input.link != null && typeof input.link !== 'string') || (link && !isHttpsUrl(link))) {
    return { error: 'Enter a store link that starts with https://.' };
  }
  if ((input.imageUrl != null && typeof input.imageUrl !== 'string') || (imageUrl && !isHttpsUrl(imageUrl))) {
    return { error: 'Enter an image address that starts with https://.' };
  }
  if (input.archived !== undefined && typeof input.archived !== 'boolean') return { error: 'Archived must be true or false.' };
  return { fields: { name, cost, oneTime: input.oneTime, link, imageUrl, archived: input.archived === true } };
}
