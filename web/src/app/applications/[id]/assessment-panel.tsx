"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import MatchBadge from "../match-badge";
import { saveAssessment } from "./assessment-actions";
import type { Answer, Assessment, Rating } from "./assessment-types";
const ratings: Record<Rating, string> = { not_reviewed: "Не оценено", confirmed: "Подтверждено", partial: "Частично", not_confirmed: "Не подтверждено", clarify: "Нужно уточнить" };
const colors: Record<Rating, { backgroundColor: string; color: string }> = {
  not_reviewed: { backgroundColor: "#f1f5f9", color: "#475569" }, confirmed: { backgroundColor: "#e8f5ec", color: "#166534" },
  partial: { backgroundColor: "#fff8d9", color: "#854d0e" }, not_confirmed: { backgroundColor: "#fcebec", color: "#991b1b" }, clarify: { backgroundColor: "#e8f4fc", color: "#075985" },
};
const field = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";
export default function AssessmentPanel({ id, initial, timezone }: { id: number; initial: Assessment; timezone: string }) {
  const [saved, setSaved] = useState(initial);
  const [editing, setEditing] = useState(initial.version === 0);
  const [answers, setAnswers] = useState<Answer[]>(initial.answers);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showDraft, setShowDraft] = useState(false);
  const lock = useRef(false);
  const dirty = JSON.stringify(answers) !== JSON.stringify(saved.answers);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const done = answers.filter((item) => item.rating !== "not_reviewed").length;
  function edit(key: string, patch: Partial<Answer>) {
    setAnswers((values) => values.map((item) => item.key === key ? { ...item, ...patch } : item));
    setMessage("");
  }
  const draft = saved.criteria.map((criterion) => {
    const answer = answers.find((item) => item.key === criterion.key)!;
    return `${criterion.text}\nОценка: ${ratings[answer.rating]}\nФакты: ${answer.evidence}\nВопросы: ${answer.questions}`;
  }).join("\n\n");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await saveAssessment(id, { version: saved.version, criteria_token: saved.criteria_token, answers });
      if (result.error) setError(result.error);
      else if (result.data) { setSaved(result.data); setAnswers(result.data.answers); setMessage("Ручная оценка сохранена."); setEditing(false); setShowDraft(false); }
    } catch { setError("Сохранение не подтверждено. Черновик остаётся в форме."); }
    finally { lock.current = false; setBusy(false); }
  }
  function cancel() {
    if (dirty && !window.confirm("Отменить несохранённые изменения оценки?")) return;
    setAnswers(saved.answers); setEditing(false); setShowDraft(false); setError(""); setMessage("");
  }
  const savedDate = saved.updated_at ? new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(saved.updated_at)) : "";
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex flex-wrap items-center gap-3"><h2 className="text-lg font-semibold">Оценка по критериям вакансии</h2><MatchBadge value={saved.match} /></div><span style={{ backgroundColor: "#f1f5f9", color: "#475569", borderRadius: 999, padding: "4px 12px", fontSize: 12 }}>Ручная оценка</span></div>
    <p className="mt-2 text-sm text-slate-500">«Не подтверждено» означает, что в материалах нет подтверждения, а не отсутствие навыка. Указывайте факты из резюме, тестового или интервью.</p>
    <details className="mt-3 text-sm text-slate-500"><summary className="cursor-pointer">Как считается процент соответствия</summary><p className="mt-2">Все критерии имеют равный вес. «Подтверждено» — 1 балл, «Частично» — 0,5. Остальные варианты пока не дают баллов. Сумма делится на число всех критериев и умножается на 100, с округлением до целого. Процент основан на сохранённой ручной оценке; это не вероятность успешного найма.</p><p className="mt-2">Если есть неоценённые критерии или «Нужно уточнить», результат предварительный. Изменения в форме учитываются после сохранения.</p></details>
    {saved.criteria_changed && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Критерии вакансии изменились. Здесь сохранены критерии, по которым начата эта оценка; заметки к ним сохранены.</p>}
    {!saved.vacancy_available && <p className="mt-4 text-sm text-amber-900">Вакансия недоступна. Показаны сохранённые критерии, если оценка уже была создана.</p>}
    {message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    {!saved.criteria.length ? <p className="mt-4 text-sm text-slate-500">У вакансии пока нет критериев для оценки.</p> : !editing ? <div className="mt-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Оценено критериев: {done} из {saved.answers.length}. {savedDate && `Сохранено: ${savedDate} (${timezone}).`}</p>
        <button type="button" onClick={() => { setAnswers(saved.answers); setEditing(true); setError(""); setMessage(""); }} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-indigo-700">Редактировать</button>
      </div>
      <div style={{ overflowX: "auto", border: "1px solid #e2e8f0", borderRadius: 12 }}>
        <table aria-label="Сохранённая ручная оценка" style={{ width: "100%", minWidth: 720, tableLayout: "fixed", borderCollapse: "collapse", textAlign: "left", fontSize: 14 }}>
          <thead style={{ backgroundColor: "#f1f5f9", color: "#475569" }}><tr>
            {(["Критерий", "Оценка", "Подтверждающие факты", "Вопросы кандидату"]).map((label, index) => <th key={label} scope="col" style={{ padding: "12px 16px", fontWeight: 500, width: index === 1 ? "18%" : index === 0 ? "26%" : "28%", borderRight: index < 3 ? "1px solid #e2e8f0" : undefined }}>{label}</th>)}
          </tr></thead>
          <tbody>{saved.criteria.map((criterion, index) => {
            const answer = saved.answers.find((item) => item.key === criterion.key)!;
            const cell = { padding: "16px", verticalAlign: "top", borderRight: "1px solid #e2e8f0", overflowWrap: "anywhere" as const };
            return <tr key={criterion.key} style={{ borderTop: "1px solid #e2e8f0", backgroundColor: index % 2 ? "#f8fafc" : "#ffffff" }}>
              <th scope="row" style={{ ...cell, fontWeight: 500 }}><span>{criterion.text}</span><p className="mt-2 text-xs font-normal text-slate-500">{criterion.kind === "required" ? "Обязательный" : "Желательный"}</p></th>
              <td style={cell}><span style={{ ...colors[answer.rating], display: "inline-block", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 500 }}>{ratings[answer.rating]}</span></td>
              <td style={{ ...cell, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{answer.evidence || <span className="text-slate-400">Не указаны</span>}</td>
              <td style={{ ...cell, borderRight: undefined, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{answer.questions || <span className="text-slate-400">Не указаны</span>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div> : <form onSubmit={submit} className="mt-5 space-y-5">
      <p className="text-sm text-slate-500">Оценено критериев: {done} из {answers.length}. {dirty ? "Есть несохранённые изменения." : saved.updated_at ? `Сохранено: ${new Intl.DateTimeFormat("ru-RU", { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(saved.updated_at))} (${timezone}).` : "Оценка ещё не сохранена."}</p>
      {saved.criteria.map((criterion, index) => {
        const answer = answers.find((item) => item.key === criterion.key)!;
        return <fieldset key={criterion.key} disabled={busy} className="rounded-xl border border-slate-200 p-4">
          <legend className="px-2 text-sm font-semibold">{index + 1}. {criterion.text}</legend>
          <div className="mb-3 flex flex-wrap items-center gap-3"><span className="text-xs text-slate-500">{criterion.kind === "required" ? "Обязательный критерий" : "Желательный критерий"}</span><span style={{ ...colors[answer.rating], borderRadius: 999, padding: "3px 10px", fontSize: 12 }}>{ratings[answer.rating]}</span></div>
          <label className="block text-sm font-medium">Оценка<select aria-label={`Оценка критерия ${index + 1}`} value={answer.rating} onChange={(event) => edit(criterion.key, { rating: event.target.value as Rating })} className={`${field} mt-2`}>
            {Object.entries(ratings).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium">Подтверждающие факты<textarea aria-label={`Факты по критерию ${index + 1}`} value={answer.evidence} maxLength={3000} rows={4} onChange={(event) => edit(criterion.key, { evidence: event.target.value })} placeholder="Цитата или конкретный пример и его источник" className={`${field} mt-2`} /></label>
            <label className="block text-sm font-medium">Вопросы кандидату<textarea aria-label={`Вопросы по критерию ${index + 1}`} value={answer.questions} maxLength={3000} rows={4} onChange={(event) => edit(criterion.key, { questions: event.target.value })} placeholder="Что нужно уточнить на интервью" className={`${field} mt-2`} /></label>
          </div>
        </fieldset>;
      })}
      {error && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}
      <div className="flex flex-wrap items-center gap-4"><button type="submit" disabled={busy || (!dirty && saved.version > 0)} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy ? "Сохраняем…" : "Сохранить оценку"}</button><>{saved.version > 0 && <button type="button" disabled={busy} onClick={cancel} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm">Отмена</button>}</><button type="button" onClick={() => setShowDraft(!showDraft)} className="text-sm text-indigo-700 underline">{showDraft ? "Скрыть копию" : "Показать текст для копирования"}</button></div>
      {showDraft && <label className="block text-sm">Копия текущей оценки — выделите и скопируйте текст<textarea readOnly value={draft} rows={8} className={`${field} mt-2`} onFocus={(event) => event.target.select()} /></label>}
    </form>}
  </section>;
}
