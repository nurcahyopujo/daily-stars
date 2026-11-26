import type { Pause } from './pauses.ts';

export type Child = {
  id: string;
  displayName: string;
  startDate: string;
  archiveEffectiveDate: string | null;
  revision: number;
};

export type RoutineActivity = {
  id: string;
  label: string;
  reward: number;
  penalty?: number;
  weekdays?: number[];
};

export type TemplateVersion = {
  name: string;
  revision: number;
  effectiveDate: string;
  retired: boolean;
  activities: RoutineActivity[];
};

export type TemplateSummary = {
  id: string;
  current: TemplateVersion | null;
  pending: TemplateVersion | null;
};

export type ChildIntent =
  | { kind: 'create'; displayName: string; initialTemplateIds: string[] }
  | { kind: 'edit'; childId: string; expectedRevision: number; displayName?: string; archive?: true };

export type AssignmentVersion = {
  revision: number;
  effectiveDate: string;
  templateIds: string[];
};

export type DatedRules<T> = { current: T | null; pending: T | null };
export type TemplateDetail = TemplateSummary & { affectedChildren: string[] };
/**
 * A child's assignment plan. `revision` is the child's assignment revision, which
 * pause saves advance too (ADR 0006); send it as `expectedRevision` for either.
 * `pauses` lists running and upcoming pauses only.
 */
export type AssignmentDetail = DatedRules<AssignmentVersion> & { revision: number; pauses: Pause[] };
export type RuleSave = { id: string; revision: number; effectiveDate: string };
/** A pause save: the new assignment revision of every child it touched. */
export type PauseSave = RuleSave & { children: { id: string; revision: number }[] };
