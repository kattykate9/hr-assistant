import { apiFetch } from "@/lib/api";
import CandidateCard from "./candidate-card";
import type { ApplicationCard } from "./types";
export const dynamic = "force-dynamic";

export default async function CandidatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const query = await searchParams;
  const backValue = Array.isArray(query.back) ? query.back[0] : query.back;
  const back = backValue && (backValue === "/applications" || backValue.startsWith("/applications?") || backValue === "/planning" || backValue.startsWith("/planning?")) ? backValue : "/applications";
  let data: ApplicationCard | null = null;
  let error = "";
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) error = "Некорректный адрес карточки.";
  else {
    try {
      const response = await apiFetch(`${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/recruiting/applications/${id}`, {
        cache: "no-store", signal: AbortSignal.timeout(10000),
      });
      if (response.ok) data = await response.json();
      else error = response.status === 404 ? "Отклик не найден." : response.status === 401 ? "Нужно снова войти в кабинет." : "Не удалось загрузить карточку.";
    } catch { error = "Нет связи с Python-сервером. Попробуйте обновить страницу."; }
  }
  return <main className="min-h-screen bg-slate-50 px-5 py-8 font-sans text-slate-900">
    <div className="mx-auto max-w-6xl">
      <nav className="mb-6 flex flex-wrap gap-5 text-sm text-indigo-600"><a href={back}>{back.startsWith("/planning") ? "← К планированию" : "← К списку откликов"}</a><a href="/">Обзор</a><a href="/settings">Настройки</a></nav>
      {data ? <CandidateCard initial={data} /> : <div role="alert" className="rounded-2xl bg-amber-50 p-6 text-amber-900">{error}<a href={`/applications/${encodeURIComponent(id)}`} className="ml-3 underline">Обновить</a></div>}
    </div>
  </main>;
}
