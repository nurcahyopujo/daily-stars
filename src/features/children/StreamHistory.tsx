import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import type { Score } from '../../../shared/scoring';

/** A collapsible audit list of one stream's score revisions. Shared by the day's
 *  activity rows and its one-off entries. */
export function StreamHistory({ entries }: { entries: Score[] }) {
  if (!entries.length) return null;
  return (
    <Collapsible>
      <CollapsibleTrigger>History</CollapsibleTrigger>
      <CollapsibleContent><ol>
        {entries.map((r) => (
          <li key={r.revision}>
            {r.outcome.replaceAll('_', ' ')} · {r.points} stars {r.reason} · {r.actor} ·{' '}
            {new Date(r.recorded).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta' })} Jakarta
          </li>
        ))}
      </ol></CollapsibleContent>
    </Collapsible>
  );
}
