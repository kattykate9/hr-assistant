import { loadPlanning, taskDate, TaskBadge } from "./planning-data";
export default async function TaskDashboard() {
  const data = await loadPlanning(new URLSearchParams({ page_size: "3" }));
  return <section id="tasks" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">Планирование по кандидатам</h2><a href="/planning" className="text-sm font-medium text-indigo-600 underline">Все действия →</a></div>
    {!data ? <p role="alert" className="mt-3 text-sm text-amber-800">Не удалось загрузить действия. Обновите страницу.</p> : <>
      <p className="mt-2 text-xs text-slate-500">Последние 3 обновлённых действия · новые изменения сверху · {data.timezone}.</p>
      {!data.items.length ? <p className="mt-4 text-sm text-slate-500">Действий пока нет. Добавьте следующее действие в карточке кандидата.</p> : <ul className="mt-3 divide-y divide-slate-100">{data.items.map((task) => <li key={task.application_id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-3"><a href={`/applications/${task.application_id}?back=${encodeURIComponent('/planning')}`} className="font-medium text-indigo-700">{task.name}</a><TaskBadge task={task} /></div><p className="mt-1 break-words text-sm">{task.title}</p><p className="mt-1 text-xs text-slate-500">Срок: {taskDate(task.due_at, data.timezone)} · Обновлено: {taskDate(task.updated_at, data.timezone)}</p></li>)}</ul>}
    </>}
  </section>;
}
