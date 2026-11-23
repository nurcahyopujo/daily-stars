import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { RootShell } from './features/auth/RootShell';
import { ProfilePage } from './features/auth/ProfilePage';
import { useSession } from './features/auth/session-context';
import { ChildProfiles } from './features/children/ChildProfiles';
import { RuleSettings } from './features/children/RuleSettings';
import { ChildDayRoute, ChildPrizesRoute, ChildReviewRoute } from './features/children/child-routes';

function HomePage() {
  return (
    <section className="welcome" aria-label="Home">
      <p className="eyebrow">A little progress, every day</p>
      <h1>Small steps.<br />Bright days.</h1>
      <p className="intro">A place for your family’s routines, daily activities, and points.</p>
    </section>
  );
}

function NotFoundPage() {
  return (
    <section aria-label="Page not found">
      <h1>Page not found</h1><p>Choose a page from the main menu.</p>
    </section>
  );
}

function ChildProfilesPage() {
  const { sessionExpired } = useSession();
  return <ChildProfiles onSessionExpired={sessionExpired} />;
}

function RuleSettingsPage() {
  const { sessionExpired } = useSession();
  return <RuleSettings onSessionExpired={sessionExpired} />;
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
  createRoute({ getParentRoute: () => rootRoute, path: '/children', component: ChildProfilesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/children/$childId/day', validateSearch: dateSearch, component: ChildDayRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/children/$childId/prizes', component: ChildPrizesRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/children/$childId/review', validateSearch: dateSearch, component: ChildReviewRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/templates', component: RuleSettingsPage }),
]);

export const router = createRouter({ routeTree, trailingSlash: 'never' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
