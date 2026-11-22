import { useId } from 'react';
import type { TemplateVersion } from '../../../shared/profiles';

export function moveItem<T>(items: T[], index: number, direction: number): T[] {
  const ordered = [...items];
  [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]];
  return ordered;
}

export function TemplatePicker({ options, selected, onChange, title }: {
  options: { id: string; version: TemplateVersion; pendingDate?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  title: string;
}) {
  const prefix = useId();
  return <fieldset className="child-profiles-templates">
    <legend>{title}</legend>
    {!options.length && <p>No templates available.</p>}
    {options.map(({ id, version, pendingDate }) => <label className="child-profiles-template" key={id}>
      <input type="checkbox" aria-label={version.name} aria-describedby={`${prefix}-${id}`} checked={selected.includes(id)} onChange={(event) => onChange(
        event.target.checked ? [...selected, id] : selected.filter(item => item !== id),
      )}/>
      <span>{version.name}<small id={`${prefix}-${id}`}>
        {version.activities?.slice(0, 3).map(activity => activity.label).join(' · ')}
        {pendingDate && <span> Scheduled change: {pendingDate}</span>}
      </small></span>
    </label>)}
    {selected.length > 0 && <ol className="child-profiles-order" aria-label="Template order">
      {selected.map((id, index) => <li key={id}>
        <span>{options.find(option => option.id === id)?.version.name ?? 'Unavailable template'}</span>
        <button type="button" disabled={index === 0} onClick={() => onChange(moveItem(selected, index, -1))} aria-label={`Move template ${index + 1} up`}>↑</button>
        <button type="button" disabled={index === selected.length - 1} onClick={() => onChange(moveItem(selected, index, 1))} aria-label={`Move template ${index + 1} down`}>↓</button>
        <button type="button" onClick={() => onChange(selected.filter(item => item !== id))} aria-label={`Remove template ${index + 1}`}>Remove</button>
      </li>)}
    </ol>}
  </fieldset>;
}
