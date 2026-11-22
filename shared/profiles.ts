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
export type AssignmentDetail = DatedRules<AssignmentVersion>;
export type RuleSave = { id: string; revision: number; effectiveDate: string };
