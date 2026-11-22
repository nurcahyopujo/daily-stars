export type Activity = {
  id: string;
  label: string;
  reward: number;
  penalty?: number;
  weekdays?: number[];
  template: string;
  templateId: string;
  stream: string;
};
export type Score = {
  stream: string;
  revision: number;
  points: number;
  reason: string;
  outcome: string;
  actor: string;
  recorded: string;
};
export type Day = { today: string; activities: Activity[]; history: Score[]; net: number; total: number };
