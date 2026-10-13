import type { CandidateTask } from "./applications/[id]/task-types";
export type PlanningItem = CandidateTask & { name: string; vacancy_title: string | null; source: string };
export type PlanningData = { items: PlanningItem[]; counts: Record<string, number>; total: number; page: number; pages: number; timezone: string; generated_at: string; status: string };
export async function loadPlanning(query: URLSearchParams): Promise<PlanningData | null> {
  try { const response = await fetch(`${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/recruiting/tasks/list?${query}`, { cache: "no-store", signal: AbortSignal.timeout(10000) }); if (response.ok) return await response.json(); } catch {}
  return null;
}
export function taskDate(value: string, timezone: string) { return new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
export function TaskBadge({ task }: { task: PlanningItem }) {
  return <span style={{ display: "inline-block", backgroundColor: task.completed_at ? "#e8f5ec" : task.overdue ? "#fcebec" : "#e8f4fc", color: task.completed_at ? "#166534" : task.overdue ? "#991b1b" : "#075985", borderRadius: 999, padding: "4px 11px", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>{task.completed_at ? "Выполнено" : task.overdue ? "Просрочено" : "Запланировано"}</span>;
}
