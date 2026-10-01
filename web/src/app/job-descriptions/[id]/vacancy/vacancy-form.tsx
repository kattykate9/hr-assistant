"use client";

import { useActionState, useRef, useState } from "react";

type Result = { error: string; id?: number; created?: boolean };
type Criterion = { text: string; evidence: string };
type Draft = {
  title: string;
  description: string;
  criteria: Criterion[];
  preferred_criteria: Criterion[];
  questions: string[];
};
export type DraftResult = { error: string; draft?: Draft };
export type CompanyProfile = {
  company_name: string; company_description: string; website: string; hr_email: string;
  vacancy_language: string;
};
type Props = {
  title: string;
  action: (previous: Result, form: FormData) => Promise<Result>;
  company: CompanyProfile | null;
  prepare: (shareWithOpenAI: boolean, language: string) => Promise<DraftResult>;
};
const field = "mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900";

export default function VacancyForm({ title, action, prepare, company }: Props) {
  const [result, submit, pending] = useActionState<Result, FormData>(action, { error: "" });
  const [values, setValues] = useState({ title, description: "", criteria: "", preferred_criteria: "", language: company?.vacancy_language ?? "ru" });
  const [reviewed, setReviewed] = useState(false);
  const [consent, setConsent] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiError, setAIError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edited, setEdited] = useState(false);
  const generationLock = useRef(false);
  const busy = pending || generating;
  const [profileNotice, setProfileNotice] = useState("");
  const headings: Record<string, string[]> = {
    ru: ["О компании", "Сайт", "Контакт HR"],
    en: ["About the company", "Website", "HR contact"],
    uk: ["Про компанію", "Сайт", "Контакт HR"],
  };
  const labels = headings[values.language] ?? headings.ru;
  const hasCompany = Boolean(company && (company.company_name || company.company_description || company.website || company.hr_email));
  const companyText = hasCompany && company ? [
    labels[0], company.company_name, company.company_description,
    company.website ? `${labels[1]}: ${company.website}` : "",
    company.hr_email ? `${labels[2]}: ${company.hr_email}` : "",
  ].filter(Boolean).join("\n") : "";
  const profileIncluded = Boolean(companyText && values.description.includes(companyText));

  function addCompany() {
    if (busy || !companyText || profileIncluded) return;
    const combined = [values.description.trim(), companyText].filter(Boolean).join("\n\n");
    if (combined.length > 20000) {
      setProfileNotice("Описание станет длиннее 20 000 символов. Сократите текст перед добавлением профиля.");
      return;
    }
    change("description", combined);
    setProfileNotice("Сведения о компании добавлены. Проверьте текст и язык описания.");
  }

  function change(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setReviewed(false);
    setEdited(true);
  }

  async function generate() {
    if (busy || generationLock.current) return;
    if (!consent) { setAIError("Подтвердите передачу JD в OpenAI."); return; }
    if ((edited || draft) && !window.confirm("Заменить текущий текст формы новым черновиком ИИ? Введённые правки будут заменены только при успешном ответе.")) return;
    generationLock.current = true;
    setGenerating(true);
    setAIError("");
    try {
      const response = await prepare(consent, values.language);
      if (response.error || !response.draft) {
        setAIError(response.error || "ИИ не вернул текст. Поля не изменены.");
        return;
      }
      const next = response.draft;
      setValues({
        language: values.language,
        title: next.title,
        description: next.description,
        criteria: next.criteria.map((item) => item.text).join("\n"),
        preferred_criteria: next.preferred_criteria.map((item) => item.text).join("\n"),
      });
      setProfileNotice("");
      setDraft(next);
      setReviewed(false);
      setEdited(false);
    } catch {
      setAIError("Не удалось получить черновик. Введённые данные остались в форме.");
    } finally {
      generationLock.current = false;
      setGenerating(false);
    }
  }

  if (result.id) {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-white p-6">
        <h2 className="text-xl font-semibold">
          {result.created ? `Вакансия №${result.id} создана` : `Для этой версии JD уже есть вакансия №${result.id}`}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Вакансия сохранена в приложении и доступна в списке вакансий Telegram-бота.
          На hh.ru она не опубликована. При повторной отправке существующая вакансия не изменяется.
        </p>
        <a href="/#vacancies" className="mt-5 inline-block rounded-xl bg-indigo-600 px-5 py-3 text-sm text-white">Перейти к вакансиям</a>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
        <label className="block text-sm font-medium">Язык вакансии
          <select value={values.language} onChange={(event) => change("language", event.target.value)} disabled={busy} className={field}>
            <option value="ru">Русский</option><option value="en">English</option><option value="uk">Українська</option>
          </select>
        </label>
        <p className="text-xs leading-5 text-slate-500">По умолчанию — язык из настроек компании. ИИ будет готовить текст на выбранном языке. Уже введённый вручную текст автоматически не переводится.</p>
        {hasCompany ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium">Сведения о компании: {company?.company_name || "профиль"}</summary>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{companyText}</p>
          </details>
        ) : <p className="text-sm text-amber-800">{company ? "Профиль компании ещё не заполнен." : "Не удалось загрузить настройки компании. Выберите язык вручную или обновите страницу."}</p>}
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={addCompany} disabled={busy || !hasCompany || profileIncluded}
            className="rounded-xl border border-indigo-200 px-4 py-2 text-sm font-medium text-indigo-700 disabled:opacity-50">
            {profileIncluded ? "Сведения уже добавлены" : "Добавить сведения в описание"}
          </button>
          <a href="/settings" target="_blank" rel="noopener noreferrer" className="text-sm text-indigo-600 underline">Настройки компании ↗</a>
        </div>
        <p className="text-xs leading-5 text-slate-500">Сведения для кнопки загружены при открытии этой страницы. После изменения настроек обновите страницу, предварительно сохранив нужные правки.</p>
        {profileNotice && <p role="status" className="text-sm text-slate-600">{profileNotice}</p>}
      </section>
      <section aria-busy={generating} className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-6">
        <h2 className="text-lg font-semibold">Черновик по Job Description</h2>
        <p className="text-sm leading-6 text-slate-600">
          ИИ предложит описание и критерии по утверждённому JD. Проверьте факты и условия перед сохранением.
          Можно также заполнить форму вручную.
        </p>
        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} className="mt-1" />
          Разрешаю передать текст этого JD и публичный профиль компании в OpenAI для подготовки черновика. Запрос оплачивается через API.
        </label>
        <button type="button" onClick={generate} disabled={busy || !consent}
          className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50">
          {generating ? "Готовим текст…" : draft ? "Подготовить заново" : "Подготовить вакансию с ИИ"}
        </button>
        <p aria-live="polite" className="text-sm text-slate-600">
          {generating ? "Дождитесь ответа, не закрывая страницу." : draft ? "Черновик добавлен в форму. Вакансия ещё не сохранена." : ""}
        </p>
        {aiError && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{aiError}</p>}
      </section>

      {draft && draft.questions.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="font-semibold">Что нужно уточнить</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6">
            {draft.questions.map((question, index) => <li key={index}>{question}</li>)}
          </ul>
          <p className="mt-3 text-sm text-slate-600">После уточнения внесите согласованные сведения в текст ниже. Эти вопросы не попадут в вакансию.</p>
        </section>
      )}

      <form action={submit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6">
        <input type="hidden" name="language" value={values.language} />
        <fieldset disabled={busy} className="space-y-5">
          <label className="block text-sm font-medium">Название вакансии
            <input name="title" value={values.title} onChange={(event) => change("title", event.target.value)} required maxLength={200} className={field} />
          </label>
          <label className="block text-sm font-medium">Публичное описание
            <textarea name="description" value={values.description} onChange={(event) => change("description", event.target.value)} required minLength={20} maxLength={20000} rows={12}
              placeholder="Задачи, требования и согласованные условия работы." className={field} />
          </label>
          <p className="text-xs leading-5 text-slate-500">Внутренние заметки и несогласованные условия сюда переносить не нужно.</p>
          <label className="block text-sm font-medium">Обязательные критерии — каждый с новой строки
            <textarea name="criteria" value={values.criteria} onChange={(event) => change("criteria", event.target.value)} required rows={5} maxLength={16000}
              placeholder="Укажите обязательные требования из утверждённого JD" className={field} />
          </label>
          <label className="block text-sm font-medium">Желательные критерии — каждый с новой строки
            <textarea name="preferred_criteria" value={values.preferred_criteria} onChange={(event) => change("preferred_criteria", event.target.value)} rows={4} maxLength={16000}
              placeholder="Укажите дополнительные навыки из JD или оставьте поле пустым" className={field} />
          </label>
          {draft && (
            <details className="rounded-xl bg-slate-50 p-4 text-sm">
              <summary className="cursor-pointer font-medium">На какие фрагменты JD опирался ИИ</summary>
              <p className="mt-3 text-xs text-slate-500">Цитаты относятся к первоначальному предложению ИИ; ваши последующие правки нужно проверить отдельно.</p>
              <ul className="mt-3 space-y-4">
                {[...draft.criteria, ...draft.preferred_criteria].map((item, index) => (
                  <li key={index}><p className="font-medium">{item.text}</p><blockquote className="mt-1 whitespace-pre-wrap border-l-2 border-indigo-200 pl-3 text-slate-600">{item.evidence}</blockquote></li>
                ))}
              </ul>
            </details>
          )}
          <label className="flex items-start gap-3 text-sm text-slate-600">
            <input type="checkbox" name="reviewed" value="yes" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} required className="mt-1" />
            Я проверила факты, условия и критерии. Вакансию можно показывать кандидатам в нашем приложении и боте.
          </label>
          {result.error && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{result.error}</p>}
          <button type="submit" disabled={busy} className="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50">
            {pending ? "Сохраняем…" : "Создать вакансию"}
          </button>
        </fieldset>
      </form>
    </div>
  );
}
