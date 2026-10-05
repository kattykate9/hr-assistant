import type { Assessment } from "./assessment-types";
export type ApplicationCard = {
  application: { id: number; name: string; contact: string; resume_text: string; source: string; status: string; vacancy_id: number; vacancy_title: string | null; created_at: string; review_version: number };
  events: { id: number; event_type: "stage" | "note"; old_status: string | null; new_status: string | null; note: string | null; created_at: string }[];
  stage_history: { id: number; status: string; started_at: string; notes: { id: number; text: string; created_at: string }[] }[];
  assessment: Assessment;
  events_total: number;
  timezone: string;
  stages: Record<string, string>;
};
export type SaveResult = { data?: ApplicationCard; error?: string };
