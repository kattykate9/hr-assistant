import { loadPlanning, taskDate, TaskBadge } from "../planning-data";
export const dynamic = "force-dynamic";
const statuses = { all: "Все", planned: "Запланировано", overdue: "Просрочено", completed: "Выполнено" };
export default async function PlanningPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const get = (key: string) => Array.isArray(params[key]) ? params[key][0] : params[key];
  const rawStatus = get("status") ?? "all";
  const status = Object.prototype.hasOwnProperty.call(statuses, rawStatus) ? rawStatus : "all";
  const rawPage = Number(get("page") ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const query = new URLSearchParams({ status, page: String(page) });
  const data = await loadPlanning(query);
  const link = (nextStatus: string, nextPage = 1) => `/planning?${new URLSearchParams({ status: nextStatus, page: String(nextPage) })}`;
  const back = link(status, data?.page ?? page);
  const cell = { padding: "14px 16px", verticalAlign: "top", overflowWrap: "anywhere" as const };
  return <main className="min-h-screen bg-slate-50 px-5 py-8 font-sans text-slate-900"><div className="mx-auto max-w-7xl space-y-5">
    <nav className="flex flex-wrap gap-5 text-sm text-indigo-600"><a href="/">← На главную</a><a href="/applications">Отклики</a><a href="/settings">Настройки</a></nav>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-3xl font-semibold">Планирование</h1><a href={back} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm">Обновить</a></div>
    <p className="text-sm text-slate-500">Текущее или последнее действие по каждому отклику. Последние изменения сверху. Перенос, завершение и полная история — в карточке кандидата.</p>
    <nav aria-label="Статус действия" className="flex flex-wrap gap-2">{Object.entries(statuses).map(([value, label]) => <a key={value} href={link(value)} aria-current={status === value ? "page" : undefined} style={{ padding: "9px 15px", borderRadius: 12, backgroundColor: status === value ? "#ede9fe" : "#ffffff", color: status === value ? "#5b21b6" : "#475569", border: "1px solid #e2e8f0", fontSize: 14 }}>{label}{data ? ` · ${data.counts[value]}` : ""}</a>)}</nav>
    {!data ? <p role="alert" className="rounded-xl bg-amber-50 p-5 text-sm text-amber-900">Не удалось загрузить планирование. Проверьте сервер и обновите страницу.</p> : <>
      <p className="text-xs text-slate-500">Найдено: {data.total} · {data.timezone} · Состояние на {taskDate(data.generated_at, data.timezone)}.</p>
      {!data.items.length ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Действий с этим статусом нет.</div> : <div style={{ overflowX: "auto", backgroundColor: "white", border: "1px solid #e2e8f0", borderRadius: 16 }}>
        <table aria-label="Планирование по кандидатам" style={{ width: "100%", minWidth: 880, tableLayout: "fixed", borderCollapse: "collapse", textAlign: "left", fontSize: 14 }}>
          <thead style={{ backgroundColor: "#f1f5f9", color: "#475569" }}><tr>{["Кандидат / вакансия", "Действие", "Срок", "Статус", "Обновлено"].map((label, i) => <th key={label} scope="col" style={{ ...cell, fontWeight: 500, width: i < 2 ? "26%" : "16%" }}>{label}</th>)}</tr></thead>
          <tbody>{data.items.map((task) => <tr key={task.application_id} style={{ borderTop: "1px solid #e2e8f0" }}>
            <td style={cell}><a href={`/applications/${task.application_id}?back=${encodeURIComponent(back)}`} className="font-medium text-indigo-700">{task.name}</a><p className="mt-2 text-xs text-slate-500">{task.vacancy_title ?? "Вакансия недоступна"}</p></td>
            <td style={cell}><p>{task.title}</p>{task.comment && <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">Комментарий</summary><p className="mt-2 whitespace-pre-wrap break-words leading-6">{task.comment}</p></details>}</td>
            <td style={cell}>{taskDate(task.due_at, data.timezone)}</td>
            <td style={cell}><TaskBadge task={task} />{task.completed_at && <p className="mt-2 text-xs text-slate-500">{taskDate(task.completed_at, data.timezone)}</p>}</td>
            <td style={cell}>{taskDate(task.updated_at, data.timezone)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {data.pages > 1 && <nav aria-label="Страницы планирования" className="flex items-center justify-between gap-4 text-sm">{data.page > 1 ? <a href={link(status, data.page-1)} className="text-indigo-600">← Назад</a> : <span />}<span>Страница {data.page} из {data.pages}</span>{data.page < data.pages ? <a href={link(status, data.page+1)} className="text-indigo-600">Далее →</a> : <span />}</nav>}
    </>}
  </div></main>;
}
