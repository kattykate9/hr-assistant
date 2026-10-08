"use server";
import { headers } from "next/headers";
export type ArchiveResult = { id: number; vacancy_status: "active" | "archived"; archived_at: string | null; archive_version: number };
export async function changeVacancyStatus(id: number, status: "active" | "archived", version: number): Promise<{ data?: ArchiveResult; error?: string }> {
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(version) || version < 1 || !["active", "archived"].includes(status)) return { error: "Некорректный запрос." };
  const authorization = (await headers()).get("authorization");
  if (!authorization) return { error: "Войдите в кабинет заново." };
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/vacancies/${id}/status`, { method: "PATCH", headers: { Authorization: authorization, "Content-Type": "application/json", "X-HR-Action": "candidate-workflow" }, body: JSON.stringify({ status, version }), cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (response.ok) return { data: await response.json() };
    if (response.status === 409) return { error: "Статус изменился в другой вкладке. Обновите страницу перед повтором." };
    if (response.status === 404) return { error: "Вакансия не найдена. Обновите страницу." };
    if ([401, 403].includes(response.status)) return { error: "Доступ не подтверждён. Войдите в кабинет заново." };
    return { error: "Сервер не подтвердил изменение статуса. Обновите страницу и проверьте результат." };
  } catch { return { error: "Нет ответа сервера. Обновите страницу и проверьте статус перед повтором." }; }
}
