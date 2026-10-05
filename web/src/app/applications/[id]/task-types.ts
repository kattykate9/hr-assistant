export type CandidateTask = { application_id: number; title: string; comment: string; due_at: string; due_local: string; completed_at: string | null; version: number; updated_at: string; overdue: boolean };
export type TaskState = { task: CandidateTask | null; timezone: string; generated_at: string; history: { id: number; action: string; created_at: string; task: CandidateTask }[] };
export type TaskPayload = { version: number; title?: string; comment?: string; due_local?: string; timezone?: string };
