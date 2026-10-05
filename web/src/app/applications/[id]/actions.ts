"use server";
import { headers } from "next/headers";
import type { SaveResult } from "./types";

export async function saveCandidate(applicationId: number, kind: "stage" | "note", payload: { version: number; status?: string; text?: string; request_id?: string }): Promise<SaveResult> {
  if (!Number.isSafeInteger(applicationId) || applicationId <= 0 || !Number.isSafeInteger(payload.version) || payload.version < 1 || !["stage", "note"].includes(kind)) return { error: "Некорректный запрос. Обновите карточку." };
  if (kind === "note" && (!payload.text?.trim() || payload.text.length > 5000 || !payload.request_id)) return { error: "Введите заметку от 1 до 5000 символов." };
  const authorization = (await headers()).get("authorization");
  if (!authorization) return { error: "Нужно снова войти в кабинет." };
  const body = kind === "stage" ? { version: payload.version, status: payload.status } : { version: payload.version, text: payload.text, request_id: payload.request_id };
  try {
    const response = await fetch(`http://127.0.0.1:8000/recruiting/applications/${applicationId}/${kind === "stage" ? "stage" : "notes"}`, {
      method: kind === "stage" ? "PATCH" : "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json", "X-HR-Action": "candidate-workflow" },
      body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      if (response.status === 409) return { error: "Карточка изменилась. Скопируйте черновик заметки, обновите страницу и проверьте историю." };
      if ([401, 403].includes(response.status)) return { error: "Доступ не подтверждён. Войдите в кабинет заново." };
      if (response.status === 404) return { error: "Отклик больше не найден." };
      if (response.status === 422) return { error: "Проверьте этап и текст заметки (до 5000 символов)." };
      return { error: "Сохранение не подтверждено. Проверьте историю перед повторной отправкой." };
    }
    return { data: await response.json() };
  } catch {
    return { error: "Сохранение не подтверждено: нет ответа сервера. Проверьте историю в другой вкладке. Повтор той же заметки из этой формы защищён от дублей." };
  }
}
