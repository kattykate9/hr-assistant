"use server";
import { headers } from "next/headers";
import type { TaskPayload, TaskState } from "./task-types";
export async function saveTask(id: number, kind: "save" | "complete", payload: TaskPayload): Promise<{ data?: TaskState; error?: string }> {
  if (!Number.isSafeInteger(id) || id <= 0 || !["save", "complete"].includes(kind)) return { error: "Некорректный запрос." };
  const authorization = (await headers()).get("authorization");
  if (!authorization) return { error: "Войдите в кабинет заново. Скопируйте черновик перед обновлением." };
  try {
    const response = await fetch(`http://127.0.0.1:8000/recruiting/applications/${id}/task${kind === "complete" ? "/complete" : ""}`, {
      method: kind === "complete" ? "POST" : "PUT", headers: { Authorization: authorization, "Content-Type": "application/json", "X-HR-Action": "candidate-workflow" },
      body: JSON.stringify(kind === "complete" ? { version: payload.version } : payload), cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (response.ok) return { data: await response.json() };
    if ([409, 422].includes(response.status)) { const body = await response.json(); return { error: typeof body.detail === "string" ? body.detail : "Проверьте название, дату и время действия." }; }
    return { error: "Не удалось подтвердить сохранение. Проверьте вход в кабинет и повторите запрос." };
  } catch { return { error: "Нет ответа сервера. Черновик остаётся в форме. Можно повторить сохранение." }; }
}
