"use client";
import { useRef, useState, type FormEvent } from "react";
import AIPanel from "./ai-panel";
import CommunicationPanel from "./communication-panel";
import ResumePreview from "./resume-preview";
import ReplyPanel from "./reply-panel";
import TaskPanel from "./task-panel";
import AssessmentPanel from "./assessment-panel";
import { saveCandidate } from "./actions";
import type { ApplicationCard } from "./types";
const sources: Record<string, string> = { hh: "hh.ru", telegram: "Telegram", linkedin: "LinkedIn", djinni: "Djinni", website: "Сайт", manual: "Вручную" };
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
const box = "rounded-2xl border border-slate-200 bg-white p-5 sm:p-6";
const button = "rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50";

export default function CandidateCard({ initial }: { initial: ApplicationCard }) {
  const [data, setData] = useState(initial);
  const [stage, setStage] = useState(initial.application.status);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const noteRequest = useRef<string | null>(null);
  const a = data.application;
  const stageLabel = (value: string | null) => value ? data.stages[value] ?? value : "—";
  function date(value: string) {
    return new Intl.DateTimeFormat("ru-RU", { timeZone: data.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  }
  async function submit(event: FormEvent, kind: "stage" | "note") {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setSuccess("");
    try {
      if (kind === "note" && !noteRequest.current) noteRequest.current = crypto.randomUUID();
      const result = await saveCandidate(a.id, kind, kind === "stage" ? { version: a.review_version, status: stage } : { version: a.review_version, text: note, request_id: noteRequest.current! });
      if (result.error) setError(result.error);
      else if (result.data) {
        setData(result.data); setStage(result.data.application.status);
        if (kind === "note") { setNote(""); noteRequest.current = null; }
        setSuccess(kind === "stage" ? "Этап сохранён." : "Заметка добавлена.");
      }
    } catch { setError("Сохранение не подтверждено. Проверьте историю в другой вкладке перед повтором."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="space-y-6">
    <header className={box}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium text-indigo-600">Карточка кандидата</p><h1 className="mt-2 break-words text-3xl font-semibold">{a.name}</h1><p className="mt-2 text-slate-500">{a.vacancy_title ?? "Вакансия недоступна"}</p></div><span style={stageStyle(a.status)}>{stageLabel(a.status)}</span></div>
      <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3"><div><dt className="text-slate-500">Контакт</dt><dd className="mt-1 break-words font-medium">{a.contact}</dd></div><div><dt className="text-slate-500">Источник</dt><dd className="mt-1">{sources[a.source] ?? a.source}</dd></div><div><dt className="text-slate-500">Отклик получен</dt><dd className="mt-1">{date(a.created_at)}</dd></div></dl>
      <p className="mt-4 text-xs text-slate-400">Даты указаны в часовом поясе {data.timezone}. Этап относится к этому отклику на вакансию.</p>
    </header>
    {error && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{error} <a href="" className="underline">Обновить карточку</a></p>}
    {success && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{success}</p>}
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <section className={box}><h2 className="text-lg font-semibold">Резюме</h2><ResumePreview key={a.id} text={a.resume_text} /><p className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">AI анализирует сведения резюме по критериям вакансии. Итоговое решение принимает рекрутер.</p></section>
      <div className="space-y-6">
        <section className={box}><h2 className="text-lg font-semibold">Этап подбора</h2><form onSubmit={(event) => submit(event, "stage")} className="mt-4 space-y-4"><label className="block text-sm">Выберите этап<select aria-label="Этап подбора" value={stage} onChange={(event) => setStage(event.target.value)} disabled={busy} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3">{Object.entries(data.stages).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className={button} disabled={busy || stage === a.status}>Сохранить этап</button><p className="text-xs text-slate-500">Можно выбрать любой этап или вернуться к предыдущему. Изменение попадёт в историю.</p></form></section>
        <section className={box}><h2 className="text-lg font-semibold">Заметка рекрутера</h2><form onSubmit={(event) => submit(event, "note")} className="mt-4 space-y-3"><textarea aria-label="Заметка рекрутера" value={note} onChange={(event) => { setNote(event.target.value); noteRequest.current = null; }} disabled={busy} required maxLength={5000} rows={5} placeholder="Что обсудили, что уточнить, следующий шаг…" className="w-full rounded-xl border border-slate-300 p-3 text-sm" /><div className="flex items-center justify-between gap-3"><button className={button} disabled={busy || !note.trim()}>Добавить заметку</button><span className="text-xs text-slate-400">{note.length} / 5000</span></div><p className="text-xs text-slate-500">Заметка сохранится к этапу «{stageLabel(a.status)}». Для другого этапа сначала сохраните его.</p></form></section>
      </div>
    </div>
    <ReplyPanel key={`reply-${a.id}`} id={a.id} initial={initial.reply_tracking} />
    <CommunicationPanel key={a.id} id={a.id} name={a.name} vacancy={a.vacancy_title} />
    <TaskPanel id={a.id} initial={initial.next_action} />
    <AIPanel key={`ai-${a.id}`} id={a.id} initial={initial.ai_assessment} timezone={data.timezone} />
    <AssessmentPanel id={a.id} initial={initial.assessment} timezone={data.timezone} />
    <section className={box}>
      <h2 className="text-lg font-semibold">История этапов и заметок</h2>
      <p className="mt-2 text-sm text-slate-500">Заметки расположены напротив этапа, на котором они добавлены. Последний этап сверху. Время: {data.timezone}.</p>
      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200">
        <table aria-label="Этапы подбора и заметки" className="w-full min-w-[640px] table-fixed border-collapse text-left text-sm">
          <thead className="bg-slate-100 text-slate-600"><tr>
            <th scope="col" className="w-44 border-r border-slate-200 px-4 py-3 font-medium">Начало этапа</th>
            <th scope="col" className="w-40 border-r border-slate-200 px-4 py-3 font-medium">Этап подбора</th>
            <th scope="col" className="px-4 py-3 font-medium">Заметки на этом этапе</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-200">
            {data.stage_history.map((entry) => <tr key={entry.id} className="align-top odd:bg-white even:bg-slate-50/70">
              <td className="border-r border-slate-200 px-4 py-4 text-slate-500"><time dateTime={entry.started_at}>{date(entry.started_at)}</time></td>
              <td className="border-r border-slate-200 px-4 py-4"><span style={stageStyle(entry.status)}>{stageLabel(entry.status)}</span></td>
              <td className="px-4 py-4">{entry.notes.length ? <ul className="divide-y divide-slate-100">{entry.notes.map((item) => <li key={item.id} className="py-3 first:pt-0 last:pb-0"><time dateTime={item.created_at} className="text-xs text-slate-500">{date(item.created_at)}</time><p className="mt-1 whitespace-pre-wrap break-words leading-6 text-slate-700">{item.text}</p></li>)}</ul> : <span className="text-slate-400">Нет заметок</span>}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>
  </div>;
}
