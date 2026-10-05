import TaskDashboard from "./task-dashboard";
import { headers } from "next/headers";
import ReportPanel, { type RecruitmentReport } from "./report-panel";
import VacancyList, { type Vacancy } from "./vacancy-list";

export const dynamic = "force-dynamic";

async function load<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`http://127.0.0.1:8000${path}`, {
      headers: { Authorization: (await headers()).get("authorization") ?? "" },
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch { return null; }
}

export default async function Home({ searchParams }: { searchParams: Promise<{ report?: string }> }) {
  const params = await searchParams;
  const mode = params.report === "current" ? "current" : "latest";
  const [vacancies, report] = await Promise.all([
    load<Vacancy[]>("/vacancies?include_archived=true"), load<RecruitmentReport>(`/recruiting/report?mode=${mode}`),
  ]);
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-5 px-6 py-5">
          <a href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-sm font-bold text-white">
              HR
            </span>
            <span className="text-lg font-semibold">HR Assistant</span>
          </a>

          <nav className="flex flex-wrap gap-5 text-sm text-slate-600">
            <a href="/job-descriptions" className="hover:text-indigo-600">Job Description</a>
            <a href="#overview" className="hover:text-indigo-600">
              Отчёт
            </a>
            <a href="#vacancies" className="hover:text-indigo-600">
              Вакансии
            </a>
            <a href="/applications" className="hover:text-indigo-600">
              Отклики
            </a>
            <a href="#integrations" className="hover:text-indigo-600">
              Интеграции
            </a>
            <a href="/planning" className="hover:text-indigo-600">Планирование</a>
            <a href="/settings" className="hover:text-indigo-600">Настройки</a>
          </nav>

          <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
            Локальный прототип
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-10 px-6 py-10">
        <ReportPanel report={report} mode={mode} />
        <TaskDashboard />
        <section id="vacancies" className="scroll-mt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-xl font-semibold">Вакансии</h2><p className="mt-1 text-sm text-slate-500">Активные вакансии доступны в боте. Закрытые хранятся в архиве вместе с откликами.</p></div>
            <a href="/applications" className="text-sm font-medium text-indigo-600 hover:underline">Все отклики →</a>
          </div>
          {!Array.isArray(vacancies) ? <p role="alert" className="mt-5 text-sm text-amber-800">Не удалось загрузить вакансии. Обновите страницу.</p>
            : vacancies.length === 0 ? <p className="mt-5 text-sm text-slate-500">Вакансий пока нет.</p>
            : <VacancyList vacancies={vacancies} counts={report?.vacancy_application_counts ?? null} />}
        </section>
        <section id="integrations" className="scroll-mt-6">
          <h2 className="text-xl font-semibold">Интеграции</h2>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {[
              {
                name: "Telegram",
                text: "Приём откликов реализован. Бот запускается отдельно.",
              },
              {
                name: "hh.ru",
                text: "Готовим приложение к регистрации. API не подключён.",
              },
              {
                name: "Google и отчёты",
                text: "Синхронизация и отправка отчётов по расписанию ещё не подключены.",
              },
            ].map((item) => (
              <div
                key={item.name}
                className="rounded-2xl border border-slate-200 bg-white p-6"
              >
                <h3 className="font-semibold">{item.name}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-t border-slate-200 pt-6 text-xs text-slate-500">
          Локальная версия. Доступ по учётной записи администратора.
        </footer>
      </main>
    </div>
  );
}