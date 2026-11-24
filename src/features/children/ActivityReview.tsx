import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from 'recharts';
import { Link } from '@tanstack/react-router';
import { BackLabel, backLinkClass } from './BackLink';
import { useEffect, useRef, useState } from 'react';
import type { ActivityReviewData, DailyStars, DateRange, OutcomeCounts } from '../../../shared/activity-review';
import type { Child } from '../../../shared/profiles';
import { requestJson, RequestError } from './requests';
import './activity-review.css';

const chartConfig = {
  net: { label: 'Net', color: 'var(--color-action)' },
  routine: { label: 'Routine', color: '#6f8572' },
  oneOff: { label: 'One-off', color: 'var(--color-focus)' },
} satisfies ChartConfig;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const REVIEW_PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '28', label: 'Last 4 weeks' },
] as const;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Format a Jakarta YYYY-MM-DD string without constructing a Date (which would
// reinterpret it in the viewer's timezone).
function shortDate(iso: string) {
  const [, month, day] = iso.split('-');
  return MONTHS[Number(month) - 1] + ' ' + Number(day);
}

// Weekday + short date for the chart tooltip, computed in UTC so the calendar
// date's weekday never shifts with the viewer's timezone.
function fullDate(iso: string) {
  const [year, month, day] = iso.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAYS[weekday] + ', ' + shortDate(iso);
}

function Dates({ range }: { range: DateRange }) {
  return <><time dateTime={range.start}>{shortDate(range.start)}</time> – <time dateTime={range.end}>{shortDate(range.end)}</time></>;
}

function signed(value: number) {
  return value > 0 ? '+' + value : String(value);
}

function Chevron() {
  return (
    <svg className="activity-review-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 10l4 4 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PeriodOutcomes({ title, counts }: { title: string; counts: OutcomeCounts }) {
  return (
    <section className="activity-review-period" aria-label={title}>
      <h4>{title}</h4>
      {counts.scheduled ? <>
        <p className="activity-review-period-lead"><strong>{counts.recorded}</strong> of {counts.scheduled} recorded</p>
        <ul>
          <li><span className="activity-review-swatch is-done" aria-hidden="true" />{counts.doneCorrectly} done correctly</li>
          <li><span className="activity-review-swatch is-improve" aria-hidden="true" />{counts.needsImprovement} needs improvement</li>
          <li><span className="activity-review-swatch is-open" aria-hidden="true" />{counts.unrecorded} unrecorded</li>
        </ul>
      </> : <p className="activity-review-period-lead">Not scheduled</p>}
    </section>
  );
}

// A thin stacked bar summarising the current period at a glance: how much was
// done correctly, needed improvement, or went unrecorded.
function OutcomeMeter({ counts }: { counts: OutcomeCounts }) {
  if (!counts.scheduled) return null;
  const pct = (part: number) => (part / counts.scheduled) * 100;
  return (
    <div className="activity-review-meter" aria-hidden="true">
      {counts.doneCorrectly > 0 && <span className="is-done" style={{ width: pct(counts.doneCorrectly) + '%' }} />}
      {counts.needsImprovement > 0 && <span className="is-improve" style={{ width: pct(counts.needsImprovement) + '%' }} />}
      {counts.unrecorded > 0 && <span className="is-open" style={{ width: pct(counts.unrecorded) + '%' }} />}
    </div>
  );
}

function ActivityOutcomes({ activities }: { activities: ActivityReviewData['activities'] }) {
  const namesakes = new Map<string, string[]>();
  const displayName = ({ template, label }: ActivityReviewData['activities'][number]) =>
    JSON.stringify([template, label]);
  for (const activity of activities) {
    const key = displayName(activity);
    const matches = namesakes.get(key);
    if (matches) matches.push(activity.stream);
    else namesakes.set(key, [activity.stream]);
  }
  for (const matches of namesakes.values()) matches.sort();
  return <>
    <h2>Activity outcomes</h2>
    {!activities.length && <p className="activity-review-note">No activities were scheduled in either period.</p>}
    {activities.length > 0 && <p className="activity-review-note">Talk about one activity. Name what went well and ask, “What could we practice together?”</p>}
    <div className="activity-review-list">
      {activities.map((activity) => {
        const matches = namesakes.get(displayName(activity))!;
        const ordinal = matches.length > 1
          ? ` · Activity ${matches.indexOf(activity.stream) + 1} of ${matches.length}`
          : '';
        const { current } = activity;
        return (
          <details className="activity-review-card" key={activity.stream}>
            <summary>
              <div className="activity-review-summary-head">
                <div className="activity-review-summary-name">
                  <h3>{activity.label}</h3>
                  <p>{activity.template}{ordinal}</p>
                </div>
                <div className="activity-review-summary-side">
                  {current.scheduled
                    ? <span className="activity-review-figure"><strong>{current.doneCorrectly}</strong><span>/{current.scheduled} done well</span></span>
                    : <span className="activity-review-figure is-muted">Not scheduled</span>}
                  <Chevron />
                </div>
              </div>
              <OutcomeMeter counts={current} />
            </summary>
            <div className="activity-review-periods">
              <PeriodOutcomes title="Current period" counts={activity.current} />
              <PeriodOutcomes title="Previous period" counts={activity.previous} />
            </div>
          </details>
        );
      })}
    </div>
  </>;
}

// A line chart of daily net stars (emphasised) with routine and one-off as
// context lines, on shadcn's chart primitive so its axis type and tooltip match
// the rest of the interface. The accessible data lives in the hidden table below.
function DailyStarsChart({ dailyStars }: { dailyStars: DailyStars[] }) {
  if (!dailyStars.length) return <p className="activity-review-note">No daily stars were recorded in this period.</p>;

  // Plot oldest → newest left to right, regardless of how the rows arrive.
  const points = [...dailyStars].sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <figure className="activity-review-chart">
      <ChartContainer config={chartConfig} className="activity-review-chart-canvas">
        <LineChart accessibilityLayer data={points} margin={{ top: 8, right: 14, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <ReferenceLine y={0} stroke="var(--color-field-border)" strokeWidth={1} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={28} tickFormatter={shortDate} />
          <YAxis width={26} tickLine={false} axisLine={false} tickMargin={6} allowDecimals={false} />
          <ChartTooltip
            cursor={{ stroke: 'var(--color-border)', strokeWidth: 1 }}
            content={<ChartTooltipContent indicator="line" labelFormatter={(value) => fullDate(String(value))} />}
          />
          <Line dataKey="routine" type="monotone" stroke="var(--color-routine)" strokeWidth={1.5} strokeDasharray="2 4" dot={false} activeDot={false} isAnimationActive={false} />
          <Line dataKey="oneOff" type="monotone" stroke="var(--color-oneOff)" strokeWidth={1.5} strokeDasharray="6 4" dot={false} activeDot={false} isAnimationActive={false} />
          <Line dataKey="net" type="monotone" stroke="var(--color-net)" strokeWidth={2.4} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
        </LineChart>
      </ChartContainer>
      <figcaption className="activity-review-legend">
        <span className="is-net">Net</span>
        <span className="is-routine">Routine</span>
        <span className="is-oneoff">One-off</span>
      </figcaption>
      <div className="activity-review-sr-only">
        <table>
          <caption>Daily stars</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Routine</th><th scope="col">One-off</th><th scope="col">Net</th></tr></thead>
          <tbody>{dailyStars.map(({ date, routine, oneOff, net }) => (
            <tr key={date}>
              <th scope="row"><time dateTime={date}>{date}</time></th>
              <td>{signed(routine)}</td><td>{signed(oneOff)}</td><td>{signed(net)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </figure>
  );
}

export function ActivityReview({ child, date, onSessionExpired }: { child: Child; date?: string; onSessionExpired: () => void }) {
  const [period, setPeriod] = useState('7');
  const [data, setData] = useState<ActivityReviewData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const periodControl = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestJson<ActivityReviewData>(
      '/api/children/' + encodeURIComponent(child.id) + '/activity-review?days=' + period,
      { signal: controller.signal },
    ).then((review) => {
      if (!controller.signal.aborted) setData(review);
    }).catch((failure) => {
      if (controller.signal.aborted) return;
      if (failure instanceof RequestError && failure.status === 401) onSessionExpired();
      else setError(true);
    });
    return () => controller.abort();
  }, [child.id, period, attempt, onSessionExpired]);

  const selectPeriod = (next: string) => {
    if (next === period) return;
    setData(null);
    setError(false);
    setPeriod(next);
  };

  return (
    <section className="child-profiles activity-review" aria-labelledby="activity-review-title">
      <Link className={backLinkClass} to="/children/$childId" params={{ childId: child.id }} search={date ? { date } : {}}><BackLabel>{child.displayName}</BackLabel></Link>
      <header className="scoring-day-head">
        <h1 id="activity-review-title">{child.displayName} · Activity review</h1>
      </header>

      <fieldset className="activity-review-periods-toggle">
        <legend>Review period</legend>
        <div role="presentation">
          {REVIEW_PERIODS.map((option, index) => (
            <label key={option.value} data-active={period === option.value}>
              <input type="radio" name="activity-review-period" value={option.value}
                ref={index === 0 ? periodControl : undefined}
                checked={period === option.value}
                onChange={() => selectPeriod(option.value)} />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>

      {!data && !error && <p className="activity-review-note" role="status">Loading activity review…</p>}
      {error && <div className="activity-review-error" role="alert">
        <p>Couldn’t load the activity review. Check your connection and try again.</p>
        <Button type="button" onClick={() => {
          periodControl.current?.focus();
          setError(false);
          setAttempt(attempt + 1);
        }}>Reload review</Button>
      </div>}

      {data && <>
        <p className="activity-review-range">
          <span>Current <Dates range={data.current} /></span>
          <span>Previous <Dates range={data.previous} /></span>
          <span className="activity-review-tz">Jakarta dates</span>
        </p>
        <ActivityOutcomes activities={data.activities} />
        <h2>Daily stars</h2>
        <DailyStarsChart dailyStars={data.dailyStars} />
      </>}
    </section>
  );
}
