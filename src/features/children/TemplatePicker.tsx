import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown } from "lucide-react";
import { useId } from 'react';
import type { TemplateVersion } from '../../../shared/profiles';

export function moveItem<T>(items: T[], index: number, direction: number): T[] {
  const ordered = [...items];
  [ordered[index], ordered[index + direction]] = [ordered[index + direction], ordered[index]];
  return ordered;
}

export function TemplatePicker({ options, selected, onChange, title, disabled }: {
  options: { id: string; version: TemplateVersion; pendingDate?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  title: string;
  disabled?: boolean;
}) {
  const prefix = useId();
  return <fieldset className="child-profiles-templates">
    <legend>{title}</legend>
    {!options.length && <p>No templates available.</p>}
    {options.map(({ id, version, pendingDate }) => <label className="child-profiles-template" key={id}>
      <Checkbox disabled={disabled} aria-label={version.name} aria-describedby={`${prefix}-${id}`} checked={selected.includes(id)} onCheckedChange={(checked) => onChange(
        checked ? [...selected, id] : selected.filter(item => item !== id),
      )}/>
      <span>{version.name}<small id={`${prefix}-${id}`}>
        {version.activities?.slice(0, 3).map(activity => activity.label).join(' · ')}
        {pendingDate && <span> Scheduled change: {pendingDate}</span>}
      </small></span>
    </label>)}
    {selected.length > 0 && <ol className="child-profiles-order" aria-label="Template order">
      {selected.map((id, index) => <li key={id}>
        <span className="child-profiles-order-name">{options.find(option => option.id === id)?.version.name ?? 'Unavailable template'}</span>
        <span className="child-profiles-order-controls">
          <Button type="button" className="child-profiles-order-move" disabled={index === 0} onClick={() => onChange(moveItem(selected, index, -1))} aria-label={`Move template ${index + 1} up`}><ChevronUp size={16} aria-hidden="true" /></Button>
          <Button type="button" className="child-profiles-order-move" disabled={index === selected.length - 1} onClick={() => onChange(moveItem(selected, index, 1))} aria-label={`Move template ${index + 1} down`}><ChevronDown size={16} aria-hidden="true" /></Button>
          <Button type="button" className="child-profiles-order-remove" onClick={() => onChange(selected.filter(item => item !== id))} aria-label={`Remove template ${index + 1}`}>Remove</Button>
        </span>
      </li>)}
    </ol>}
  </fieldset>;
}
