import { Button } from "@/components/ui/button";
import { ChevronRight, PauseCircle, Plus } from "lucide-react";
import { Link } from '@tanstack/react-router';
import type { TemplateSummary } from '../../../shared/profiles';
import { useRuleSave } from './requests';
import { useHouseholdProfiles } from './useHouseholdProfiles';
import './child-profiles.css';

function summarize(template: TemplateSummary) {
  const version = template.current ?? template.pending;
  const labels = version?.activities?.map(activity => activity.label).filter(Boolean) ?? [];
  return { version, labels };
}

// The templates index: each routine is a card linking to its own editor page (create and
// edit no longer live in a modal). A just-finished save surfaces its confirmation here.
export function TemplateList({ onSessionExpired }: { onSessionExpired: () => void }) {
  const { templates, data, loading, error, load: reload } = useHouseholdProfiles(onSessionExpired);
  const save = useRuleSave();
  const savedTemplate = 'intent' in save && save.status === 'success' && save.intent.path.startsWith('/api/templates');

  return <section className="child-profiles templates-list" aria-labelledby="templates-title" aria-busy={loading}>
    <div className="child-profiles-heading templates-heading">
      <div>
        <h1 id="templates-title">Activity templates</h1>
        <p className="templates-intro">Reusable routines you assign to a child. A new template starts today; edits take effect on the next Jakarta day.</p>
      </div>
      <div className="templates-heading-actions">
        <Link to="/templates/new" className="templates-create">
          <Plus size={17} aria-hidden="true" /><span>Create template</span>
        </Link>
        <Link to="/pauses" className="templates-pause">
          <PauseCircle size={17} aria-hidden="true" /><span>Pause routines</span>
        </Link>
      </div>
    </div>

    {savedTemplate && <p role="status" className="templates-saved">Saved {save.intent.label}. Effective {save.result.effectiveDate} · Jakarta.</p>}

    {loading && !data && <p role="status" className="tpl-loading">Loading templates…</p>}
    {error && <div role="alert" className="tpl-loaderror"><p>Couldn’t load templates. Check your connection and try again.</p>
      <Button type="button" onClick={() => void reload()}>Try again</Button>
    </div>}

    {data && (templates.length === 0
      ? <div className="templates-empty">
          <p className="templates-empty-title">No templates yet</p>
          <p>Create your first routine to start tracking a child’s daily activities.</p>
          <Link to="/templates/new" className="templates-create templates-empty-create">
            <Plus size={16} aria-hidden="true" /><span>Create template</span>
          </Link>
        </div>
      : <ul className="templates-cards">
          {templates.map(template => {
            const { version, labels } = summarize(template);
            if (!version) return null;
            const retired = version.retired || template.pending?.retired;
            return <li key={template.id}>
              <Link className="template-card" to="/templates/$templateId" params={{ templateId: template.id }}
                aria-label={`${version.retired ? 'View' : 'Edit'} ${version.name}`}>
                <span className="template-card-body">
                  <span className="template-card-top">
                    <span className="template-card-name">{version.name}</span>
                    <span className="template-card-count">{version.activities.length} {version.activities.length === 1 ? 'activity' : 'activities'}</span>
                  </span>
                  {labels.length > 0 && <span className="template-card-activities">{labels.join(' · ')}</span>}
                  {(template.pending || retired) && <span className="template-card-tags">
                    {version.retired
                      ? <span className="template-tag is-retired">Retired · {version.effectiveDate}</span>
                      : template.pending?.retired
                        ? <span className="template-tag is-retiring">Retiring · {template.pending.effectiveDate}</span>
                        : template.pending && <span className="template-tag is-scheduled">Scheduled change · {template.pending.effectiveDate}</span>}
                  </span>}
                </span>
                <ChevronRight className="template-card-chevron" size={20} aria-hidden="true" />
              </Link>
            </li>;
          })}
        </ul>)}
  </section>;
}
