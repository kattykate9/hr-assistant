export type RecruitmentReport = {
  mode: "latest" | "current"; kind: "morning" | "evening" | "current";
  timezone: string; period_start: string; period_end: string; generated_at: string;
  next_report_at: string; morning_time: string; evening_time: string;
  received: number; new_in_period: number; ai_processed: number | null;
  ai_assessment: string | null; sources: { source: string; label: string; count: number }[];
  applications_url: string; vacancy_application_counts: Record<string, number>;
  all_applications_total: number; telegram_delivery_status: string;
};
export function reportDate(value: string, zone: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: zone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}

export default function ReportPanel({ report, mode }: { report: RecruitmentReport | null; mode: string }) {
  const latest = mode !== "current";
  const maximum = Math.max(1, ...(report?.sources.map((item) => item.count) ?? []));
  return (
    <section id="overview" className="scroll-mt-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-sm font-medium text-indigo-600">Рабочее пространство рекрутера</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Отчёт по подбору</h1>
          <p className="mt-2 text-sm text-slate-500">Отклики, источники и состояние обработки.</p>
        </div>
        <a href={`/?report=${latest ? "latest" : "current"}#overview`} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-100">Обновить отчёт</a>
      </div>
      <nav aria-label="Период отчёта" className="flex flex-wrap gap-2">
        <a href="/?report=latest#overview" aria-current={latest ? "page" : undefined} className={`rounded-xl px-4 py-2 text-sm font-medium ${latest ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>Последний отчётный период</a>
        <a href="/?report=current#overview" aria-current={!latest ? "page" : undefined} className={`rounded-xl px-4 py-2 text-sm font-medium ${!latest ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-600"}`}>Текущий период</a>
      </nav>
      {!report ? <p role="alert" className="rounded-xl bg-amber-50 p-5 text-sm text-amber-900">Не удалось загрузить отчёт. Проверьте запуск Python-сервера и обновите страницу. Недоступные данные не считаются нулевыми.</p> : <>
        <div className="flex flex-wrap justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4">
          <div><h2 className="font-semibold">{report.kind === "current" ? "Текущий период · предварительная сводка" : report.kind === "morning" ? "Утренний отчёт" : "Вечерний отчёт"}</h2>
            <p className="mt-1 text-sm text-slate-600">{reportDate(report.period_start, report.timezone)} — {reportDate(report.period_end, report.timezone)}</p>
            <p className="mt-1 text-xs text-slate-500">{report.timezone === "Asia/Nicosia" ? "Время Кипра · " : "Часовой пояс · "}{report.timezone}</p>
          </div>
          <span className="self-start rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Отправка в Telegram ещё не подключена</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Поступило откликов", value: String(report.received), note: "За выбранный период" },
            { label: "Ожидают обработки", value: String(report.new_in_period), note: "Из поступивших за период · статус «Новый»" },
            { label: "Обработано ИИ", value: report.ai_processed === null ? "—" : String(report.ai_processed), note: "AI-оценка кандидатов ещё не подключена" },
            { label: "Первичная оценка", value: report.ai_assessment ?? "—", note: "Появится после подключения AI-оценки" },
          ].map((item) => <div key={item.label} className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">{item.label}</p><p className="mt-3 text-3xl font-semibold">{item.value}</p><p className="mt-2 text-xs leading-5 text-slate-500">{item.note}</p>
          </div>)}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Отклики по источникам</h2><p className="mt-1 text-xs text-slate-500">За тот же период. Нажмите на источник, чтобы открыть отклики.</p></div>
            <a href={report.applications_url} className="text-sm font-medium text-indigo-600 hover:underline">Все отклики периода →</a>
          </div>
          {report.received === 0 ? <div className="mt-5 rounded-xl bg-slate-50 p-6 text-sm leading-6 text-slate-500">За этот период откликов нет. Новые поступления после окончания отчётного периода можно увидеть во вкладке «Текущий период» или на странице всех откликов.</div> : (
            <ul aria-label="Количество откликов по источникам" className="mt-6 space-y-4">
              {report.sources.map((item) => <li key={item.source}>
                <a href={`${report.applications_url}&source=${encodeURIComponent(item.source)}`} className="group grid grid-cols-[5.5rem_1fr_3rem] items-center gap-3 rounded-lg py-1 text-sm focus-visible:outline-2 focus-visible:outline-indigo-600 sm:grid-cols-[7rem_1fr_4rem]">
                  <span className="break-words text-slate-600 group-hover:text-indigo-600">{item.label}</span>
                  <span aria-hidden="true" className="h-5 overflow-hidden rounded-md bg-slate-100"><span className="block h-full rounded-md bg-indigo-500 group-hover:bg-indigo-600" style={{ width: `${item.count / maximum * 100}%` }} /></span>
                  <span className="text-right font-semibold tabular-nums">{item.count}</span>
                </a>
              </li>)}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap justify-between gap-3 text-xs leading-5 text-slate-500">
          <p>Расписание: {report.morning_time} и {report.evening_time}. Следующий рубеж: {reportDate(report.next_report_at, report.timezone)}.<br />Сводка пересчитывается при открытии страницы; она ещё не является отправленным сообщением.</p>
          <a href="/applications" className="text-sm font-medium text-indigo-600 hover:underline">Все отклики за всё время: {report.all_applications_total} →</a>
        </div>
      </>}
    </section>
  );
}
