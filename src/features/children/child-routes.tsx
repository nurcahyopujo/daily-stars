import { Button } from "@/components/ui/button";
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';
import type { Child } from '../../../shared/profiles';
import { useSession } from '../auth/session-context';
import { useHouseholdProfiles } from './useHouseholdProfiles';
import { ScoreDay } from './ScoreDay';
import { Prizes } from './Prizes';
import { ActivityReview } from './ActivityReview';
import { ChildAssignments } from './ChildAssignments';

const dayApi = getRouteApi('/children/$childId/day');
const prizesApi = getRouteApi('/children/$childId/prizes');
const reviewApi = getRouteApi('/children/$childId/review');
const assignmentsApi = getRouteApi('/children/$childId/assignments');

// Resolve $childId against the household profiles; an unknown child redirects to the list.
function ChildGate({ childId, render }: { childId: string; render: (child: Child, today: string) => ReactNode }) {
  const { sessionExpired } = useSession();
  const { data, error, load } = useHouseholdProfiles(sessionExpired);
  const navigate = useNavigate();
  const child = data?.children.find((candidate) => candidate.id === childId);

  useEffect(() => {
    if (data && !child) void navigate({ to: '/children' });
  }, [data, child, navigate]);

  if (data && child) return render(child, data.today);
  if (error) return <section className="child-profiles"><div role="alert">
    <p>Couldn’t load this child. Check your connection and try again.</p>
    <Button type="button" onClick={() => void load()}>Try again</Button>
  </div></section>;
  return <section className="child-profiles"><p role="status">Loading…</p></section>;
}

export function ChildDayRoute() {
  const { childId } = dayApi.useParams();
  const { date } = dayApi.useSearch();
  const navigate = useNavigate();
  return <ChildGate childId={childId} render={(child, today) =>
    <ScoreDay key={child.id} child={child} today={today} date={date}
      onDateChange={(next) => void navigate({ to: '/children/$childId/day', params: { childId }, search: { date: next }, replace: true })} />} />;
}

export function ChildPrizesRoute() {
  const { childId } = prizesApi.useParams();
  return <ChildGate childId={childId} render={(child) => <Prizes key={child.id} child={child} />} />;
}

export function ChildReviewRoute() {
  const { childId } = reviewApi.useParams();
  const { date } = reviewApi.useSearch();
  const { sessionExpired } = useSession();
  return <ChildGate childId={childId} render={(child) =>
    <ActivityReview key={child.id} child={child} date={date} onSessionExpired={sessionExpired} />} />;
}

// ChildAssignments resolves the child itself (so RootShell can force-render it mid-save), so no gate here.
export function ChildAssignmentsRoute() {
  const { childId } = assignmentsApi.useParams();
  const { sessionExpired } = useSession();
  return <ChildAssignments key={childId} childId={childId} onSessionExpired={sessionExpired} />;
}
