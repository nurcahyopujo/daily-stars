import { Button } from "@/components/ui/button";
import { useSession } from './session-context';

export function ProfilePage() {
  const { parent, signOut } = useSession();
  if (!parent) return null;
  return (
    <section aria-label="Profile">
      <div className="empty-state parent-access" aria-live="polite">
        <span className="empty-star" aria-hidden="true">☆</span>
        <h2>You’re signed in</h2>
        <p className="parent-access-email">{parent.email}</p>
        <p>Today: <time dateTime={parent.today}>{parent.today}</time> · Jakarta</p>
        <Button type="button" onClick={signOut}>Sign out</Button>
      </div>
    </section>
  );
}
