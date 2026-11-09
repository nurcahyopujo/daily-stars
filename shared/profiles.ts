export type Child = {
  id: string;
  displayName: string;
  startDate: string;
  archiveEffectiveDate: string | null;
  revision: number;
};

export type TemplateVersion = {
  name: string;
  revision: number;
  effectiveDate: string;
  retired: boolean;
};

export type TemplateSummary = {
  id: string;
  current: TemplateVersion | null;
  pending: TemplateVersion | null;
};

export type ChildIntent =
  | { kind: 'create'; displayName: string; initialTemplateIds: string[] }
  | { kind: 'edit'; childId: string; expectedRevision: number; displayName?: string; archive?: true };
