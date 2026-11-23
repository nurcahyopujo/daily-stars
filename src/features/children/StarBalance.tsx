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

// Animate from the currently shown number to `value` with an ease-out: 0 → value
// on mount, then prev → next on every change, so an edit ticks by its delta
// rather than restarting from zero. Holds the final value for reduced motion.
function useCountUp(value: number, reduce: boolean) {
  const [shown, setShown] = useState(reduce ? value : 0);
  const frame = useRef(0);
  const from = useRef(reduce ? value : 0);
  useEffect(() => {
    if (reduce || from.current === value) { setShown(value); from.current = value; return; }
    const origin = from.current;
    const span = value - origin;
    const duration = Math.min(220 + Math.abs(span) * 70, 900);
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const current = Math.round(origin + span * eased);
      from.current = current;
      setShown(current);
      if (t < 1) frame.current = requestAnimationFrame(step);
      else from.current = value;
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value, reduce]);
  return shown;
}

/** The gold star glyph: vertical gradient fill, a one-shot specular sweep, and
 *  mount glints. Shared by the children cards and the day hero. */
function GoldStar({ size, reduce, animated = true }: { size: number; reduce: boolean; animated?: boolean }) {
  const live = animated && !reduce;
  const id = useId();
  const fill = `${id}-fill`;
  const shine = `${id}-shine`;
  const clip = `${id}-clip`;
  return (
    <span className={`star-balance-star${live ? ' is-live' : ''}`}>
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true">
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
        {live && (
          <g clipPath={`url(#${clip})`}>
            <rect className="star-balance-shimmer" x="0" y="0" width="48" height="48" fill={`url(#${shine})`} />
          </g>
        )}
      </svg>
      {live && <span className="star-balance-glints" aria-hidden="true"><i /><i /><i /></span>}
    </span>
  );
}

/** Gold star hero for a child's spendable balance, with the day's change beneath
 *  it. Used on the children cards. */
export function StarBalance({ balance, today, past = false }: { balance: number; today?: number; past?: boolean }) {
  const reduce = usePrefersReducedMotion();
  const shown = useCountUp(balance, reduce);
  return (
    <div className="star-balance">
      <p className="star-balance-main">
        <GoldStar size={40} reduce={reduce} />
        <span className="star-balance-figure">
          <span className="star-balance-value" aria-label={`${balance} stars`}>
            <span aria-hidden="true">{shown}</span>
          </span>
          <span className="star-balance-label" aria-hidden="true">stars to spend</span>
        </span>
      </p>
      {today !== undefined && (
        <p className={`star-balance-today${today > 0 ? ' is-up' : today < 0 ? ' is-down' : ' is-zero'}`}>
          {past
            ? today > 0 ? `+${today} earned on this date` : today < 0 ? `${today} on this date` : 'No stars on this date'
            : today > 0 ? `+${today} earned today` : today < 0 ? `${today} today` : 'No stars yet today'}
        </p>
      )}
    </div>
  );
}

/** Detail-page hero: the day's stars lead in gold, the running total sits beside
 *  them as a quiet reference stat. */
export function DayStars({ today, total, past = false }: { today: number; total: number; past?: boolean }) {
  const reduce = usePrefersReducedMotion();
  const shownToday = useCountUp(today, reduce);
  const shownTotal = useCountUp(total, reduce);
  const when = past ? 'on this date' : 'today';
  const sign = today > 0 ? '+' : today < 0 ? '−' : '';
  const todayAria =
    today > 0 ? `${today} stars earned ${when}`
    : today < 0 ? `${-today} stars lost ${when}`
    : `No stars ${past ? 'on this date' : 'yet today'}`;
  return (
    <div className={`day-stars${today > 0 ? ' is-up' : today < 0 ? ' is-down' : ' is-zero'}`}>
      <p className="day-stars-primary">
        <GoldStar size={52} reduce={reduce} />
        <span className="star-balance-figure">
          <span className="star-balance-value" aria-label={todayAria}>
            <span aria-hidden="true">{sign}{Math.abs(shownToday)}</span>
          </span>
          <span className="star-balance-label" aria-hidden="true">stars {when}</span>
        </span>
      </p>
      <p className="day-stars-total">
        <span className="day-stars-total-figure">
          <GoldStar size={22} reduce={reduce} animated={false} />
          <span className="day-stars-total-value" aria-label={`${total} stars total`}>
            <span aria-hidden="true">{shownTotal}</span>
          </span>
        </span>
        <span className="star-balance-label" aria-hidden="true">total stars</span>
      </p>
    </div>
  );
}
