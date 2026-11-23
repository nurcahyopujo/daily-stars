import { useEffect, useId, useRef, useState } from 'react';

const STAR_PATH = 'M24 3l5.9 12.9 14.1 1.6-10.4 9.6 2.8 13.9L24 34.3 11.6 41l2.8-13.9L4 17.5l14.1-1.6z';

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduce(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduce;
}

// Count 0 → value on mount with an ease-out, holding the final value for reduced motion.
function useCountUp(value: number, reduce: boolean) {
  const [shown, setShown] = useState(reduce ? value : 0);
  const frame = useRef(0);
  useEffect(() => {
    if (reduce || value === 0) { setShown(value); return; }
    const duration = Math.min(220 + Math.abs(value) * 70, 900);
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(value * eased));
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value, reduce]);
  return shown;
}

/** Gold star hero for a child's spendable balance, with today's change beneath it. */
export function StarBalance({ balance, today }: { balance: number; today?: number }) {
  const reduce = usePrefersReducedMotion();
  const shown = useCountUp(balance, reduce);
  const id = useId();
  const fill = `${id}-fill`;
  const shine = `${id}-shine`;
  const clip = `${id}-clip`;

  return (
    <div className="star-balance">
      <p className="star-balance-main">
        <span className={`star-balance-star${reduce ? '' : ' is-live'}`}>
          <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
            <defs>
              <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#c79a33" />
                <stop offset="1" stopColor="#7a5c16" />
              </linearGradient>
              <linearGradient id={shine} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#fff" stopOpacity="0" />
                <stop offset="0.5" stopColor="#fff" stopOpacity="0.85" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
              <clipPath id={clip}><path d={STAR_PATH} /></clipPath>
            </defs>
            <path d={STAR_PATH} fill={`url(#${fill})`} />
            {!reduce && (
              <g clipPath={`url(#${clip})`}>
                <rect className="star-balance-shimmer" x="0" y="0" width="48" height="48" fill={`url(#${shine})`} />
              </g>
            )}
          </svg>
          {!reduce && <span className="star-balance-glints" aria-hidden="true"><i /><i /><i /></span>}
        </span>
        <span className="star-balance-figure">
          <span className="star-balance-value" aria-label={`${balance} stars`}>
            <span aria-hidden="true">{shown}</span>
          </span>
          <span className="star-balance-label" aria-hidden="true">stars to spend</span>
        </span>
      </p>
      {today !== undefined && (
        <p className={`star-balance-today${today > 0 ? ' is-up' : today < 0 ? ' is-down' : ' is-zero'}`}>
          {today > 0 ? `+${today} earned today` : today < 0 ? `${today} today` : 'No stars yet today'}
        </p>
      )}
    </div>
  );
}
