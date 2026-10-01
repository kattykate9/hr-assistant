import { headers } from "next/headers";
import { reportDate } from "../report-panel";
export const dynamic = "force-dynamic";
type Applicant = { id: number; name: string; contact: string; resume_text: string; source: string; status: string; vacancy_id: number; vacancy_title: string | null; created_at: string };
type Data = {
  items: Applicant[]; total: number; page: number; pages: number; timezone: string;
  vacancy: { id: number; title: string } | null;
  sources: { source: string; label: string; count: number }[];
  created_from: string | null; created_before: string | null;
};
type Vacancy = { id: number; title: string };
type Params = Record<string, string | string[] | undefined>;
const knownSources: Record<string, string> = { hh: "hh.ru", telegram: "Telegram", linkedin: "LinkedIn", djinni: "Djinni", website: "Сайт", manual: "Вручную" };
const field = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const get = (name: string) => { const value = params[name]; return (Array.isArray(value) ? value[0] : value) ?? ""; };
  const filters = new URLSearchParams();
  for (const key of ["source", "vacancy_id", "created_from", "created_before", "page"]) if (get(key)) filters.set(key, get(key));
  let data: Data | null = null;
  let vacancies: Vacancy[] = [];
  let vacanciesError = false;
  let error = "";
  const requestHeaders = { Authorization: (await headers()).get("authorization") ?? "" };
  const results = await Promise.allSettled([
    fetch(`http://127.0.0.1:8000/recruiting/applications?${filters}`, { headers: requestHeaders, cache: "no-store", signal: AbortSignal.timeout(10000) }),
    fetch("http://127.0.0.1:8000/vacancies", { headers: requestHeaders, cache: "no-store", signal: AbortSignal.timeout(10000) }),
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
          <div className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_auto]">
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
                {vacancies.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
                {get("vacancy_id") && !vacancies.some((item) => String(item.id) === get("vacancy_id")) && <option value={get("vacancy_id")}>{data?.vacancy?.title ?? "Выбранная вакансия"}</option>}
              </select>
            </label>
            <button type="submit" className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white">Показать</button>
          </div>
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
          <p className="text-sm text-slate-500">Найдено: <strong className="text-slate-900">{data.total}</strong>{get("source") ? ` · ${sourceLabel(get("source"))}` : ""}</p>
          {data.items.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center"><h2 className="font-semibold">Откликов по выбранным условиям пока нет</h2><p className="mt-2 text-sm text-slate-500">Выберите другой источник или сбросьте фильтры.</p></div> : <div className="space-y-3">
            {data.items.map((application) => <details key={application.id} className="rounded-2xl border border-slate-200 bg-white">
              <summary className="cursor-pointer px-5 py-4 focus-visible:outline-2 focus-visible:outline-indigo-600">
                <span className="font-semibold">{application.name}</span>
                <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-4 text-xs text-slate-500"><span>{application.vacancy_title ?? "Вакансия недоступна"}</span><span>{sourceLabel(application.source)}</span><span className="text-indigo-600">{application.status === "new" ? "Новый" : application.status}</span><span>{dateLabel(application.created_at)}</span></span>
              </summary>
              <div className="border-t border-slate-100 px-5 py-5"><p className="break-words text-sm"><strong>Контакт: </strong>{application.contact}</p>
                <h2 className="mt-5 text-sm font-semibold">Резюме</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{application.resume_text}</p>
                <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">AI-оценка кандидата ещё не подключена.</p>
              </div>
            </details>)}
          </div>}
          {data.pages > 1 && <nav aria-label="Страницы откликов" className="flex items-center justify-between gap-4 text-sm">
            {data.page > 1 ? <a href={url({ page: String(data.page-1) })} className="rounded-xl border border-slate-200 bg-white px-4 py-2">← Назад</a> : <span />}
            <span className="text-slate-500">Страница {data.page} из {data.pages}</span>
            {data.page < data.pages ? <a href={url({ page: String(data.page+1) })} className="rounded-xl border border-slate-200 bg-white px-4 py-2">Далее →</a> : <span />}
          </nav>}
        </>}
      </div>
    </main>
  );
}
