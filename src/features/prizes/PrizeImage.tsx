import { useState } from 'react';
import { GoldStar } from '../children/StarBalance';

// A prize's product photo, loaded straight from the store (never stored in the app).
// No referrer leaves the household's address out of the store's logs. A missing or
// broken image falls back to the star placeholder; there is no automatic re-lookup.
export function PrizeImage({ src, size }: { src: string | null; size: 'card' | 'thumb' | 'preview' }) {
  const [failed, setFailed] = useState<string | null>(null);
  const broken = !src || failed === src;
  return <span className={`prize-image is-${size}${broken ? ' is-placeholder' : ''}`}>
    {broken
      ? <GoldStar size={size === 'thumb' ? 20 : 34} reduce animated={false} />
      : <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />}
  </span>;
}
