"use server";
import { apiFetch } from "@/lib/api";
import type { Assessment, Answer } from "./assessment-types";
export async function saveAssessment(id: number, payload: { version: number; criteria_token: string; answers: Answer[] }): Promise<{ data?: Assessment; error?: string }> {
  if (!Number.isSafeInteger(id) || id <= 0) return { error: "Некорректный отклик." };
  try {
    const response = await apiFetch(`${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/recruiting/applications/${id}/assessment`, {
      method: "PUT", headers: { "Content-Type": "application/json", "X-HR-Action": "candidate-workflow" },
      body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (response.ok) return { data: await response.json() };
    if (response.status === 409) return { error: "Оценка или критерии изменились в другой вкладке. Сохраните копию черновика кнопкой ниже, затем обновите страницу." };
    if (response.status === 422) return { error: "Проверьте поля: факты и вопросы — до 3000 символов каждый. Черновик остаётся в форме." };
    if ([401, 403].includes(response.status)) return { error: "Доступ не подтверждён. Сохраните копию черновика и войдите снова." };
    return { error: "Сохранение не подтверждено. Черновик остаётся в форме; можно повторить сохранение." };
  } catch { return { error: "Нет ответа сервера. Черновик остаётся в форме; можно повторить сохранение." }; }
}
