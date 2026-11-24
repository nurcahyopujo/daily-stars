import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { RootShell } from './features/auth/RootShell';
import { ProfilePage } from './features/auth/ProfilePage';
import { useSession } from './features/auth/session-context';
import { ChildProfiles } from './features/children/ChildProfiles';
import { TemplateList } from './features/children/TemplateList';
import { TemplateEditor } from './features/children/TemplateEditor';
import { ChildDayRoute, ChildPrizesRoute, ChildReviewRoute, ChildAssignmentsRoute } from './features/children/child-routes';
import { getRouteApi, useNavigate } from '@tanstack/react-router';

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
  createRoute({ getParentRoute: () => rootRoute, path: '/templates/new', component: TemplateCreatePage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/templates/$templateId', component: TemplateEditPage }),
]);

export const router = createRouter({ routeTree, trailingSlash: 'never' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
