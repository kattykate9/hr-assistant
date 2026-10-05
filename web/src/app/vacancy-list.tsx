"use client";
import { useEffect, useRef, useState } from "react";
import { changeVacancyStatus } from "./vacancy-actions";
export type Vacancy = {
  vacancy_status: "active" | "archived"; archived_at: string | null; archive_version: number;
  id: number; title: string; direction: string; description: string; criteria: string[];
  preferred_criteria?: string[]; source_jd_id?: number | null; source_jd_version?: number | null;
  language?: "ru" | "en" | "uk" | null;
};
const directions: Record<string, string> = { traffic: "Арбитраж трафика", development: "Программирование", roblox: "Roblox" };
function VacancyCard({ vacancy, count, busy, onChange }: { vacancy: Vacancy; count: number | null; busy: boolean; onChange: (vacancy: Vacancy) => void }) {
  const [open, setOpen] = useState(false);
  const contentId = `vacancy-description-${vacancy.id}`;
  return (
    <article id={`vacancy-${vacancy.id}`} className="scroll-mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-4 px-5 sm:flex-nowrap">
        <button type="button" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(!open)} className="flex min-w-0 flex-1 basis-full items-center justify-between gap-3 rounded-xl py-4 text-left focus-visible:outline-2 focus-visible:outline-indigo-600 sm:basis-auto">
          <span className="min-w-0"><span className="block break-words text-base font-semibold">{vacancy.title}</span>
            <span className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="rounded-full bg-indigo-50 px-2.5 py-1 font-medium text-indigo-700">{directions[vacancy.direction] ?? vacancy.direction}</span>
              {vacancy.vacancy_status === "archived" && <span style={{ backgroundColor: "#f1f5f9", color: "#64748b", padding: "3px 8px", borderRadius: 999 }}>В архиве</span>}
              {vacancy.language && <span>{{ ru: "Русский", en: "English", uk: "Українська" }[vacancy.language]}</span>}
            </span>
          </span>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}><path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <a href={`/applications?vacancy_id=${vacancy.id}`} aria-label={`Отклики на вакансию ${vacancy.title}: ${count ?? "количество недоступно"}`} className="mb-4 shrink-0 rounded-lg bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 focus-visible:outline-2 focus-visible:outline-indigo-600 sm:mb-0">Отклики · {count ?? "—"}</a>
        <button type="button" disabled={busy} onClick={() => onChange(vacancy)} className="mb-4 shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium disabled:opacity-50 sm:mb-0" style={{ color: vacancy.vacancy_status === "archived" ? "#4338ca" : "#9f1239" }}>{vacancy.vacancy_status === "archived" ? "Возобновить" : "Закрыть вакансию"}</button>
      </div>
      <div id={contentId} hidden={!open} className="border-t border-slate-100 px-5 py-5 sm:px-6">
        <h3 className="mb-3 text-sm font-semibold">Описание вакансии</h3>
        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{vacancy.description}</p>
        <h4 className="mt-5 text-sm font-semibold">Обязательные критерии</h4>
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-600">{vacancy.criteria.map((item, index) => <li key={index}>{item}</li>)}</ul>
        {(vacancy.preferred_criteria ?? []).length > 0 && <><h4 className="mt-5 text-sm font-semibold">Желательные критерии</h4><ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-slate-600">{vacancy.preferred_criteria?.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
        {vacancy.source_jd_id && <a href="/job-descriptions" className="mt-5 inline-block text-sm text-indigo-600 hover:underline">Перейти к Job Description →</a>}
      </div>
    </article>
  );
}
export default function VacancyList({ vacancies, counts }: { vacancies: Vacancy[]; counts: Record<string, number> | null }) {
  const [items, setItems] = useState(vacancies);
  const [filter, setFilter] = useState<"active" | "archived" | "all">("active");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { setItems(vacancies); }, [vacancies]);
  async function change(vacancy: Vacancy) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    const next = vacancy.vacancy_status === "archived" ? "active" : "archived";
    try {
      const result = await changeVacancyStatus(vacancy.id, next, vacancy.archive_version);
      if (result.error) setError(result.error);
      else if (result.data) {
        const updated = result.data;
        setItems((values) => values.map((item) => item.id === updated.id ? { ...item, ...updated } : item));
        setMessage(updated.vacancy_status === "archived" ? `Вакансия «${vacancy.title}» закрыта и доступна в архиве. Отклики сохранены.` : `Вакансия «${vacancy.title}» снова активна и доступна в боте.`);
      }
    } catch { setError("Изменение не подтверждено. Обновите страницу и проверьте статус."); }
    finally { lock.current = false; setBusy(false); }
  }
  const visible = items.filter((item) => filter === "all" || item.vacancy_status === filter);
  return <div className="mt-5 space-y-3">
    <nav aria-label="Статус вакансии" className="flex flex-wrap gap-2">{([{ value: "active", label: "Активные" }, { value: "archived", label: "Архив" }, { value: "all", label: "Все" }] as const).map(({ value, label }) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} style={{ backgroundColor: filter === value ? "#ede9fe" : "#fff", color: filter === value ? "#5b21b6" : "#475569", border: "1px solid #e2e8f0", borderRadius: 12, padding: "9px 14px", fontSize: 14 }}>{label} · {items.filter((item) => value === "all" || item.vacancy_status === value).length}</button>)}</nav>
    {busy && <p role="status" className="text-sm text-slate-500">Сохраняем статус…</p>}
    {error && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    {!visible.length ? <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">{filter === "archived" ? "В архиве пока нет вакансий." : "В этой вкладке нет вакансий."}</p> : visible.map((vacancy) => <VacancyCard key={vacancy.id} vacancy={vacancy} count={counts ? (counts[String(vacancy.id)] ?? 0) : null} busy={busy} onChange={(item) => void change(item)} />)}
  </div>;
}
