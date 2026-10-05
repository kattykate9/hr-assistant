import type { MatchSummary } from "../match-badge";
export type Rating = "not_reviewed" | "confirmed" | "partial" | "not_confirmed" | "clarify";
export type Answer = { key: string; rating: Rating; evidence: string; questions: string };
export type Assessment = {
  criteria: { key: string; text: string; kind: "required" | "preferred" }[];
  match: MatchSummary;
  criteria_token: string; answers: Answer[]; version: number; updated_at: string | null;
  criteria_changed: boolean; vacancy_available: boolean; author_type: "recruiter";
};
