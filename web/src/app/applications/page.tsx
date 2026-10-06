import ExportPanel, { ExportChoice } from "./export-panel";
import type { CandidateTask } from "./[id]/task-types";
import MatchBadge, { type MatchSummary } from "./match-badge";
import { headers } from "next/headers";
import { reportDate } from "../report-panel";
export const dynamic = "force-dynamic";
type Applicant = { next_action: CandidateTask | null; match: MatchSummary; id: number; name: string; contact: string; resume_text: string; source: string; status: string; vacancy_id: number; vacancy_title: string | null; created_at: string };
type Data = {
  items: Applicant[]; total: number; page: number; pages: number; timezone: string;
  vacancy: { id: number; title: string } | null;
  sources: { source: string; label: string; count: number }[];
  created_from: string | null; created_before: string | null;
};
type Vacancy = { id: number; title: string; vacancy_status?: "active" | "archived" };
type Params = Record<string, string | string[] | undefined>;
const knownSources: Record<string, string> = { hh: "hh.ru", telegram: "Telegram", linkedin: "LinkedIn", djinni: "Djinni", website: "Сайт", manual: "Вручную" };
const stages: Record<string, string> = { new: "Новый", screening: "Скрининг", interview: "Интервью", test: "Тестовое", offer: "Оффер", hired: "Нанят", rejected: "Отказ" };
const stageColors: Record<string, { backgroundColor: string; color: string }> = {
  new: { backgroundColor: "#f1f5f9", color: "#0f172a" },
  screening: { backgroundColor: "#e8f4fc", color: "#075985" },
  interview: { backgroundColor: "#f0eafa", color: "#6b21a8" },
  test: { backgroundColor: "#fff8d9", color: "#854d0e" },
  offer: { backgroundColor: "#fff0e3", color: "#9a3412" },
  hired: { backgroundColor: "#e8f5ec", color: "#166534" },
  rejected: { backgroundColor: "#fcebec", color: "#991b1b" },
};
const stageStyle = (status: string) => ({ ...stageColors[status] ?? stageColors.new, display: "inline-block", borderRadius: "999px", padding: "5px 12px", fontSize: "12px", fontWeight: 500, lineHeight: "20px" });
const field = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const get = (name: string) => { const value = params[name]; return (Array.isArray(value) ? value[0] : value) ?? ""; };
  const filters = new URLSearchParams();
  for (const key of ["source", "status", "vacancy_id", "created_from", "created_before", "page", "q", "assessment", "sort"]) if (get(key)) filters.set(key, get(key));
  let data: Data | null = null;
  let vacancies: Vacancy[] = [];
  let vacanciesError = false;
  let error = "";
  const requestHeaders = { Authorization: (await headers()).get("authorization") ?? "" };
  const results = await Promise.allSettled([
    fetch(`http://127.0.0.1:8000/recruiting/applications?${filters}`, { headers: requestHeaders, cache: "no-store", signal: AbortSignal.timeout(10000) }),
    fetch("http://127.0.0.1:8000/vacancies?include_archived=true", { headers: requestHeaders, cache: "no-store", signal: AbortSignal.timeout(10000) }),
  ]);
  if (results[0].status === "fulfilled") {
    const response = results[0].value;
    if (response.ok) { try { data = await response.json(); } catch { error = "Не удалось прочитать отклики."; } }
    else error = response.status === 404 ? "Выбранная вакансия не найдена." : response.status === 422 ? "Некорректные параметры фильтра. Сбросьте фильтры и выберите их заново." : response.status === 401 ? "Нужно снова войти в кабинет." : "Не удалось загрузить отклики. Проверьте Python-сервер.";
  } else error = "Нет связи с Python-сервером. Данные не загружены.";
  if (results[1].status === "fulfilled" && results[1].value.ok) {
    try { const values = await results[1].value.json(); if (Array.isArray(values)) vacancies = values; else vacanciesError = true; } catch { vacanciesError = true; }
  } else vacanciesError = true;
  const sources = data?.sources ?? Object.entries(knownSources).map(([source, label]) => ({ source, label, count: 0 }));
  const sourceLabel = (source: string) => sources.find((item) => item.source === source)?.label ?? knownSources[source] ?? source;
  function url(changes: Record<string, string>) {
    const next = new URLSearchParams(filters);
    next.delete("page");
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    return `/applications${next.size ? `?${next}` : ""}`;
  }
  function dateLabel(value: string) { try { return reportDate(value, data?.timezone ?? "Asia/Nicosia"); } catch { return value; } }
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 font-sans text-slate-900 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <nav className="flex flex-wrap gap-5 text-sm text-indigo-600"><a href="/">← Отчёт и вакансии</a><a href="/job-descriptions">Job Description</a><a href="/settings">Настройки</a></nav>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><h1 className="text-3xl font-semibold">Отклики</h1><p className="mt-2 text-sm text-slate-500">{data?.vacancy ? `На вакансию «${data.vacancy.title}»` : "Все кандидаты в одном списке"}</p></div>
          <a href={url({ page: String(data?.page ?? 1) })} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium">Обновить</a>
        </div>
        <form key={filters.toString()} method="get" action="/applications" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          {get("created_from") && <input type="hidden" name="created_from" value={get("created_from")} />}
          {get("created_before") && <input type="hidden" name="created_before" value={get("created_before")} />}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, alignItems: "end" }}>
            <label className="text-sm font-medium">Поиск кандидата
              <input type="search" name="q" maxLength={200} defaultValue={get("q")} placeholder="Имя, контакт или слова из резюме" className={field} />
            </label>
            <label className="text-sm font-medium">Ручная оценка
              <select name="assessment" defaultValue={get("assessment") || "all"} className={field}>
                <option value="all">Все отклики</option><option value="none">Без оценки</option><option value="assessed">Есть оценка</option>
              </select>
            </label>
            <label className="text-sm font-medium">Сортировка
              <select name="sort" defaultValue={get("sort") || "date_desc"} className={field}>
                <option value="date_desc">Сначала новые</option><option value="date_asc">Сначала старые</option>
                <option value="match_desc">Оценка по критериям вакансии: от большей к меньшей</option><option value="match_asc">Оценка по критериям вакансии: от меньшей к большей</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-slate-500">Поиск без учёта регистра: должны встретиться все введённые слова. При сортировке по оценке критериев вакансии отклики без оценки идут в конце.</p>
          <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
            <label className="text-sm font-medium">Источник
              <select name="source" defaultValue={get("source")} className={field}>
                <option value="">Все источники</option>
                {sources.map((item) => <option key={item.source} value={item.source}>{item.label}</option>)}
                {get("source") && !sources.some((item) => item.source === get("source")) && <option value={get("source")}>{get("source")}</option>}
              </select>
            </label>
            <label className="text-sm font-medium">Вакансия
              <select name="vacancy_id" defaultValue={get("vacancy_id")} className={field}>
                <option value="">Все вакансии</option>
                {vacancies.map((item) => <option key={item.id} value={item.id}>{item.title}{item.vacancy_status === "archived" ? " · Архив" : ""}</option>)}
                {get("vacancy_id") && !vacancies.some((item) => String(item.id) === get("vacancy_id")) && <option value={get("vacancy_id")}>{data?.vacancy?.title ?? "Выбранная вакансия"}</option>}
              </select>
            </label>
            <label className="text-sm font-medium">Этап
              <select name="status" defaultValue={get("status")} className={field}>
                <option value="">Все этапы</option>
                {Object.entries(stages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white">Показать</button>
          </div>
          {get("assessment") === "none" && <p className="text-xs text-slate-500">Без оценки: ни одному критерию ещё не назначена оценка. Сохранённый результат 0% считается оценкой.</p>}
          {vacanciesError && <p className="text-xs text-amber-800">Список вакансий недоступен. Текущий фильтр сохранён; попробуйте обновить страницу.</p>}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {[{ source: "", label: "Все источники" }, { source: "hh", label: "hh.ru" }, { source: "telegram", label: "Telegram" }].map((item) => (
              <a key={item.source} href={url({ source: item.source })} aria-current={get("source") === item.source ? "page" : undefined} className={`rounded-full px-3 py-1.5 ${get("source") === item.source ? "bg-indigo-50 font-medium text-indigo-700" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>{item.label}</a>
            ))}
            <a href="/applications" className="ml-auto text-slate-500 underline">Сбросить все фильтры</a>
          </div>
          {(get("created_from") || get("created_before")) && <div className="rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900">
            Период отчёта: {get("created_from") ? dateLabel(get("created_from")) : "с начала"} — {get("created_before") ? dateLabel(get("created_before")) : "по настоящее время"} · {data?.timezone ?? "Asia/Nicosia"}.
            <a href={url({ created_from: "", created_before: "" })} className="ml-2 underline">За всё время</a>
          </div>}
        </form>
        {error ? <p role="alert" className="rounded-xl bg-amber-50 p-5 text-sm text-amber-900">{error}</p> : data && <>
          <ExportPanel key={filters.toString()} query={filters.toString()} total={data.total} choices={data.items.map(({id, name, source}) => ({id, name, source}))}>
          <p className="text-sm text-slate-500">Найдено: <strong className="text-slate-900">{data.total}</strong>{get("source") ? ` · ${sourceLabel(get("source"))}` : ""}</p>
          {data.items.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center"><h2 className="font-semibold">Откликов по выбранным условиям пока нет</h2><p className="mt-2 text-sm text-slate-500">Измените поисковый запрос или фильтры.</p></div> : <div className="space-y-3">
            {data.items.map((application) => <div key={application.id}><ExportChoice id={application.id} name={application.name} blocked={application.source === "hh"} /><a href={`/applications/${application.id}?back=${encodeURIComponent(`/applications?${filters}`)}`} className="block rounded-2xl border border-slate-200 bg-white px-5 py-4 transition hover:border-indigo-300 hover:bg-indigo-50/30 focus-visible:outline-2 focus-visible:outline-indigo-600">
              <div className="flex flex-wrap items-center justify-between gap-3"><span className="font-semibold text-indigo-700">{application.name}</span><span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}><MatchBadge value={application.match} /><span style={stageStyle(application.status)}>{stages[application.status] ?? application.status}</span></span></div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><span>{application.vacancy_title ?? "Вакансия недоступна"}</span><span>{sourceLabel(application.source)}</span><span>{dateLabel(application.created_at)}</span></div>
              {application.next_action && <div style={{ marginTop: 12, borderRadius: 10, padding: "10px 12px", backgroundColor: application.next_action.overdue ? "#fcebec" : "#f1f5f9", color: application.next_action.overdue ? "#991b1b" : "#475569", fontSize: 12 }}>
                <strong>{application.next_action.overdue ? "Просрочено" : "Следующее действие"}:</strong> {application.next_action.title} · {dateLabel(application.next_action.due_at)} ({data.timezone})
              </div>}
              <p className="mt-3 text-xs text-slate-500">Открыть карточку →</p>
            </a></div>)}
          </div>}
          {data.pages > 1 && <nav aria-label="Страницы откликов" className="flex items-center justify-between gap-4 text-sm">
            {data.page > 1 ? <a href={url({ page: String(data.page-1) })} className="rounded-xl border border-slate-200 bg-white px-4 py-2">← Назад</a> : <span />}
            <span className="text-slate-500">Страница {data.page} из {data.pages}</span>
            {data.page < data.pages ? <a href={url({ page: String(data.page+1) })} className="rounded-xl border border-slate-200 bg-white px-4 py-2">Далее →</a> : <span />}
          </nav>}
          </ExportPanel>
        </>}
      </div>
    </main>
  );
}
