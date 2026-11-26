import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { RootShell } from './features/auth/RootShell';
import { ProfilePage } from './features/auth/ProfilePage';
import { useSession } from './features/auth/session-context';
import { ChildProfiles } from './features/children/ChildProfiles';
import { TemplateList } from './features/children/TemplateList';
import { TemplateEditor } from './features/children/TemplateEditor';
import { ChildDayRoute, ChildPrizesRoute, ChildReviewRoute, ChildAssignmentsRoute } from './features/children/child-routes';
import { PauseRoutines } from './features/children/PauseRoutines';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { PrizeList } from './features/prizes/PrizeList';
import { PrizeEditor } from './features/prizes/PrizeEditor';
import { lastPrizeQuery, parsePrizeQuery } from './features/prizes/prize-query';

function HomePage() {
  const { sessionExpired } = useSession();
  return (
    <>
      <section className="welcome" aria-label="Home">
        <p className="eyebrow">A little progress, every day</p>
        <h1>Small steps.<br />Bright days.</h1>
        <p className="intro">A place for your family’s routines, daily activities, and points.</p>
      </section>
      <ChildProfiles onSessionExpired={sessionExpired} />
    </>
  );
}

function NotFoundPage() {
  return (
    <section aria-label="Page not found">
      <h1>Page not found</h1><p>Choose a page from the main menu.</p>
    </section>
  );
}

function TemplateListPage() {
  const { sessionExpired } = useSession();
  return <TemplateList onSessionExpired={sessionExpired} />;
}

function TemplateCreatePage() {
  const { sessionExpired } = useSession();
  const navigate = useNavigate();
  return <TemplateEditor target={{ kind: 'create' }} onSessionExpired={sessionExpired}
    onSaved={() => void navigate({ to: '/templates' })} />;
}

const templateEditApi = getRouteApi('/templates/$templateId');
function TemplateEditPage() {
  const { templateId } = templateEditApi.useParams();
  const { sessionExpired } = useSession();
  const navigate = useNavigate();
  return <TemplateEditor key={templateId} target={{ kind: 'edit', id: templateId }} onSessionExpired={sessionExpired}
    onSaved={() => void navigate({ to: '/templates' })} />;
}

const pausesApi = getRouteApi('/pauses');
function PauseRoutinesPage() {
  const { childId, templateId } = pausesApi.useSearch();
  const { sessionExpired } = useSession();
  return <PauseRoutines key={`${childId}/${templateId}`} childId={childId} templateId={templateId} onSessionExpired={sessionExpired} />;
}

// Optional preselection for the pause page: a child, and one of its templates.
const pauseSearch = (search: Record<string, unknown>): { childId?: string; templateId?: string } => {
  const pick = (value: unknown) => typeof value === 'string' && value.length <= 128 ? value : undefined;
  const childId = pick(search.childId);
  const templateId = childId ? pick(search.templateId) : undefined;
  return { ...(childId ? { childId } : {}), ...(templateId ? { templateId } : {}) };
};

const prizeListApi = getRouteApi('/prizes');
function PrizeListPage() {
  const query = prizeListApi.useSearch();
  const { sessionExpired } = useSession();
  const navigate = useNavigate();
  return <PrizeList query={query} onSessionExpired={sessionExpired}
    onQueryChange={(next) => void navigate({ to: '/prizes', search: next, replace: true })} />;
}

function PrizeCreatePage() {
  const { sessionExpired } = useSession();
  const navigate = useNavigate();
  return <PrizeEditor target={{ kind: 'create' }} onSessionExpired={sessionExpired}
    onSaved={() => void navigate({ to: '/prizes', search: lastPrizeQuery() })} />;
}

const prizeEditApi = getRouteApi('/prizes/$prizeId');
function PrizeEditPage() {
  const { prizeId } = prizeEditApi.useParams();
  const { sessionExpired } = useSession();
  const navigate = useNavigate();
  return <PrizeEditor key={prizeId} target={{ kind: 'edit', id: prizeId }} onSessionExpired={sessionExpired}
    onSaved={() => void navigate({ to: '/prizes', search: lastPrizeQuery() })} />;
}

// A selected activity date is a view selection, not a page: a validated search param.
const dateSearch = (search: Record<string, unknown>): { date?: string } => {
  const { date } = search;
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { date } : {};
};

const rootRoute = createRootRoute({ component: RootShell, notFoundComponent: NotFoundPage });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/home', component: HomePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/profile', component: ProfilePage }),
  // The children list now lives on Home; keep the old URL working by redirecting it there.
  createRoute({ getParentRoute: () => rootRoute, path: '/children', beforeLoad: () => { throw redirect({ to: '/' }); } }),
  createRoute({ getParentRoute: () => rootRoute, path: '/children/$childId', validateSearch: dateSearch, component: ChildDayRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/children/$childId/prizes', component: ChildPrizesRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/children/$childId/review', validateSearch: dateSearch, component: ChildReviewRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/children/$childId/assignments', component: ChildAssignmentsRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/templates', component: TemplateListPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/pauses', validateSearch: pauseSearch, component: PauseRoutinesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/templates/new', component: TemplateCreatePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/templates/$templateId', component: TemplateEditPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/prizes', validateSearch: parsePrizeQuery, component: PrizeListPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/prizes/new', component: PrizeCreatePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/prizes/$prizeId', component: PrizeEditPage }),
]);

export const router = createRouter({ routeTree, trailingSlash: 'never' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
