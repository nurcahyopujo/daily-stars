import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import type { ActivityReviewData, DateRange, OutcomeCounts } from '../../../shared/activity-review';
import type { Child } from '../../../shared/profiles';
import { requestJson, RequestError } from './requests';
import './activity-review.css';

const REVIEW_PERIODS = [
  { value: '7', label: 'Last 7 days' },
  { value: '28', label: 'Last 4 weeks' },
] as const;

function Dates({ range }: { range: DateRange }) {
  return <><time dateTime={range.start}>{range.start}</time> to <time dateTime={range.end}>{range.end}</time></>;
}

function signed(value: number) {
  return value > 0 ? '+' + value : String(value);
}

function PeriodOutcomes({ title, counts }: { title: string; counts: OutcomeCounts }) {
  return (
    <section aria-label={title}>
      <h4>{title}</h4>
      {counts.scheduled ? <>
        <p><strong>{counts.recorded} of {counts.scheduled} recorded</strong></p>
        <ul>
          <li>{counts.doneCorrectly} done correctly</li>
          <li>{counts.needsImprovement} needs improvement</li>
          <li>{counts.unrecorded} unrecorded</li>
        </ul>
      </> : <p>Not scheduled</p>}
    </section>
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
    {!activities.length && <p>No activities were scheduled in either period.</p>}
    {activities.length > 0 && <p>Talk about one activity. Name what went well and ask, “What could we practice together?”</p>}
    {activities.map((activity) => {
      const matches = namesakes.get(displayName(activity))!;
      const ordinal = matches.length > 1
        ? ` · Activity ${matches.indexOf(activity.stream) + 1} of ${matches.length}`
        : '';
      return (
        <article className="activity-review-card" key={activity.stream}>
          <h3>{activity.label}</h3>
          <p>{activity.template}{ordinal}</p>
          <div className="activity-review-periods">
            <PeriodOutcomes title="Current period" counts={activity.current} />
            <PeriodOutcomes title="Previous period" counts={activity.previous} />
          </div>
        </article>
      );
    })}
  </>;
}

export function ActivityReview({ child, date, onSessionExpired }: { child: Child; date?: string; onSessionExpired: () => void }) {
  const [period, setPeriod] = useState('7');
  const [data, setData] = useState<ActivityReviewData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const periodControl = useRef<HTMLButtonElement>(null);

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

  return (
    <section className="child-profiles activity-review" aria-labelledby="activity-review-title">
      <Link to="/children/$childId/day" params={{ childId: child.id }} search={date ? { date } : {}}>← Back to day</Link>
      <h1 id="activity-review-title">{child.displayName}’s activity review</h1>
      <label htmlFor="activity-review-period">Review period</label>
      <Select
        items={REVIEW_PERIODS}
        value={period}
        onValueChange={(next) => {
          if (next == null) return;
          setData(null);
          setError(false);
          setPeriod(next);
        }}
      >
        <SelectTrigger id="activity-review-period" ref={periodControl} className="activity-review-period">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REVIEW_PERIODS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!data && !error && <p role="status">Loading activity review…</p>}
      {error && <div role="alert">
        <p>Couldn’t load the activity review. Check your connection and try again.</p>
        <Button type="button" onClick={() => {
          periodControl.current?.focus();
          setError(false);
          setAttempt(attempt + 1);
        }}>Reload review</Button>
      </div>}
      {data && <>
        <p>Current period: <Dates range={data.current} /><br />Previous period: <Dates range={data.previous} /><br />Jakarta dates</p>
        <ActivityOutcomes activities={data.activities} />
        <p className="activity-review-scroll-hint">Scroll sideways to see all columns.</p>
        <div className="activity-review-table" role="region" aria-label="Daily stars" tabIndex={0}>
        <Table>
          <TableCaption>Daily stars</TableCaption>
          <TableHeader><TableRow>
            <TableHead scope="col">Date</TableHead>
            <TableHead scope="col">Routine</TableHead>
            <TableHead scope="col">One-off</TableHead>
            <TableHead scope="col">Net</TableHead>
          </TableRow></TableHeader>
          <TableBody>{data.dailyStars.map(({ date, routine, oneOff, net }) => (
            <TableRow key={date}>
              <TableHead scope="row"><time dateTime={date}>{date}</time></TableHead>
              <TableCell>{signed(routine)}</TableCell>
              <TableCell>{signed(oneOff)}</TableCell>
              <TableCell>{signed(net)}</TableCell>
            </TableRow>
          ))}</TableBody>
        </Table>
        </div>
      </>}
    </section>
  );
}
