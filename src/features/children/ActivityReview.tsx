import { useEffect, useState } from 'react';
import type { ActivityReviewData, DateRange, OutcomeCounts } from '../../../shared/activity-review';
import type { Child } from '../../../shared/profiles';
import { requestJson, RequestError } from './requests';
import './activity-review.css';

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

export function ActivityReview({ child, onSessionExpired }: { child: Child; onSessionExpired: () => void }) {
  const [period, setPeriod] = useState('7');
  const [data, setData] = useState<ActivityReviewData | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const day = new URLSearchParams(location.search).get('date');
  const dayQuery = new URLSearchParams({ day: child.id, ...(day ? { date: day } : {}) });

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
      <a href={'/children?' + dayQuery}>← Back to day</a>
      <h1 id="activity-review-title">{child.displayName}’s activity review</h1>
      <label htmlFor="activity-review-period">Review period</label>
      <select id="activity-review-period" value={period} onChange={(event) => {
        setData(null);
        setError(false);
        setPeriod(event.target.value);
      }}>
        <option value="7">Last 7 days</option>
        <option value="28">Last 4 weeks</option>
      </select>
      {!data && !error && <p role="status">Loading activity review…</p>}
      {error && <div role="alert">
        <p>Couldn’t load the activity review. Check your connection and try again.</p>
        <button type="button" onClick={() => {
          setError(false);
          setAttempt(attempt + 1);
        }}>Reload review</button>
      </div>}
      {data && <>
        <p>Current period: <Dates range={data.current} /><br />Previous period: <Dates range={data.previous} /><br />Jakarta dates</p>
        <ActivityOutcomes activities={data.activities} />
        <table>
          <caption>Daily stars</caption>
          <thead><tr>
            <th scope="col">Activity date</th>
            <th scope="col">Routine points</th>
            <th scope="col">One-off points</th>
            <th scope="col">Net stars</th>
          </tr></thead>
          <tbody>{data.dailyStars.map(({ date, routine, oneOff, net }) => (
            <tr key={date}>
              <th scope="row"><time dateTime={date}>{date}</time></th>
              <td>{signed(routine)}</td>
              <td>{signed(oneOff)}</td>
              <td>{signed(net)}</td>
            </tr>
          ))}</tbody>
        </table>
      </>}
    </section>
  );
}
