"use client";
import { useActionState, useState } from "react";

type Fields = {
  company_name: string; company_description: string; website: string; hr_email: string;
  vacancy_language: string; report_timezone: string; morning_report_time: string; evening_report_time: string;
};
export type Settings = Fields & { version: number; updated_at: string | null; reports_status: "not_connected" };
export type SaveResult = { error: string; version: number; saved?: Settings };
type Props = { initial: Settings; action: (previous: SaveResult, form: FormData) => Promise<SaveResult> };
const field = "mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900";
const languages = [{ value: "ru", label: "Русский" }, { value: "en", label: "English" }, { value: "uk", label: "Українська" }];
const zones = ["Asia/Nicosia", "Europe/Minsk", "Europe/London", "Europe/Berlin", "Europe/Moscow", "Europe/Kyiv", "America/New_York", "Asia/Dubai", "UTC"];

export default function SettingsForm({ initial, action }: Props) {
  const [values, setValues] = useState<Fields>({
    company_name: initial.company_name, company_description: initial.company_description,
    website: initial.website, hr_email: initial.hr_email, vacancy_language: initial.vacancy_language,
    report_timezone: initial.report_timezone, morning_report_time: initial.morning_report_time,
    evening_report_time: initial.evening_report_time,
  });
  const [result, submit, pending] = useActionState<SaveResult, FormData>(action, { error: "", version: initial.version });
  const baseline = result.saved ?? initial;
  const changed = (Object.keys(values) as (keyof Fields)[]).some((key) => values[key].trim() !== baseline[key]);
  function change(name: keyof Fields, value: string) { setValues((current) => ({ ...current, [name]: value })); }
  return (
    <form action={submit} className="space-y-6">
      <input type="hidden" name="version" value={result.version} />
      <fieldset disabled={pending} className="space-y-6">
        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold">О компании</h2>
          <label className="block text-sm font-medium">Название компании *
            <input name="company_name" value={values.company_name} onChange={(e) => change("company_name", e.target.value)} required maxLength={200} className={field} autoComplete="organization" />
          </label>
          <label className="block text-sm font-medium">Описание для кандидатов
            <textarea name="company_description" value={values.company_description} onChange={(e) => change("company_description", e.target.value)} rows={5} maxLength={5000} className={field} placeholder="Чем занимается компания, команда и продукт. Только сведения для кандидатов." />
          </label>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block text-sm font-medium">Сайт
              <input name="website" type="url" value={values.website} onChange={(e) => change("website", e.target.value)} maxLength={2000} className={field} placeholder="https://example.com" />
            </label>
            <label className="block text-sm font-medium">Рабочая почта HR
              <input name="hr_email" type="email" value={values.hr_email} onChange={(e) => change("hr_email", e.target.value)} maxLength={254} className={field} placeholder="hr@example.com" />
            </label>
          </div>
          <label className="block text-sm font-medium">Язык вакансий по умолчанию
            <select name="vacancy_language" value={values.vacancy_language} onChange={(e) => change("vacancy_language", e.target.value)} className={field}>
              {languages.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <p className="text-xs leading-5 text-slate-500">Язык подставляется в форму новой вакансии. Профиль можно добавить в описание одной кнопкой; при подготовке с ИИ он передаётся вместе с JD. Существующие вакансии не меняются.</p>
        </section>

        <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Ежедневные отчёты</h2>
            <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">Отправка не подключена</span>
          </div>
          <p className="text-sm leading-6 text-slate-600">Задайте время будущих сводок в Telegram. Сохранение настроек пока не включает автоматическую отправку.</p>
          <label className="block text-sm font-medium">Часовой пояс отчётов
            <input name="report_timezone" list="report-zones" value={values.report_timezone} onChange={(e) => change("report_timezone", e.target.value)} required maxLength={100} className={field} />
            <datalist id="report-zones">{zones.map((zone) => <option key={zone} value={zone} />)}</datalist>
          </label>
          <p className="text-xs leading-5 text-slate-500">Для времени Кипра оставьте Asia/Nicosia. Часовой пояс хранится с правилами перехода на летнее и зимнее время.</p>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block text-sm font-medium">Утренний отчёт
              <input name="morning_report_time" type="time" step={60} required value={values.morning_report_time} onChange={(e) => change("morning_report_time", e.target.value)} className={field} />
            </label>
            <label className="block text-sm font-medium">Вечерний отчёт
              <input name="evening_report_time" type="time" step={60} required value={values.evening_report_time} onChange={(e) => change("evening_report_time", e.target.value)} className={field} />
            </label>
          </div>
          <p className="text-sm text-slate-600">Выбрано: {values.morning_report_time || "—"} и {values.evening_report_time || "—"} · {values.report_timezone || "укажите часовой пояс"}</p>
        </section>

        <div aria-live="polite">
          {result.error ? <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{result.error}</p>
            : result.saved && !changed ? <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">Настройки сохранены. Отправка отчётов пока не подключена.</p>
            : changed ? <p className="text-sm text-slate-500">Есть несохранённые изменения.</p> : null}
        </div>
        <button type="submit" disabled={pending} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50">{pending ? "Сохраняем…" : "Сохранить настройки"}</button>
      </fieldset>
    </form>
  );
}
