"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { saveTask } from "./task-actions";
import type { TaskState } from "./task-types";
const field = "mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";
const button = "rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50";
export default function TaskPanel({ id, initial }: { id: number; initial: TaskState }) {
  const [state, setState] = useState(initial);
  const [editing, setEditing] = useState(!initial.task);
  const [title, setTitle] = useState(initial.task?.title ?? "");
  const [comment, setComment] = useState(initial.task?.comment ?? "");
  const [due, setDue] = useState(initial.task?.due_local ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const task = state.task;
  const base = task && !task.completed_at ? task : null;
  const dirty = editing && (title !== (base?.title ?? "") || comment !== (base?.comment ?? "") || due !== (base?.due_local ?? ""));
  useEffect(() => { if (!dirty) return; const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: state.timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  function edit() { setTitle(base?.title ?? ""); setComment(base?.comment ?? ""); setDue(base?.due_local ?? ""); setError(""); setMessage(""); setEditing(true); }
  function cancel() { if (dirty && !window.confirm("Отменить несохранённые изменения действия?")) return; setEditing(false); setError(""); }
  async function send(kind: "save" | "complete") {
    if (lock.current) return; lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await saveTask(id, kind, kind === "complete" ? { version: task!.version } : { version: task?.version ?? 0, title, comment, due_local: due, timezone: state.timezone });
      if (result.error) setError(result.error);
      else if (result.data) { setState(result.data); setEditing(false); setMessage(kind === "complete" ? "Действие выполнено." : "Действие сохранено."); }
    } catch { setError("Сохранение не подтверждено. Проверьте соединение и повторите запрос."); }
    finally { lock.current = false; setBusy(false); }
  }
  function submit(event: FormEvent) { event.preventDefault(); void send("save"); }
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <h2 className="text-lg font-semibold">Следующее действие</h2>
    <p className="mt-2 text-sm text-slate-500">Срок указывается в часовом поясе {state.timezone}. У одного отклика — одно ближайшее действие.</p>
    {error && <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}
    {message && <p role="status" className="mt-4 text-sm text-emerald-800">{message}</p>}
    {editing ? <form onSubmit={submit} className="mt-5 space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        <label className="block text-sm font-medium">Действие<input aria-label="Действие" list={`task-options-${id}`} value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} className={field} placeholder="Выберите из списка или напишите своё" /></label>
        <datalist id={`task-options-${id}`}>{["Связаться с кандидатом", "Назначить интервью", "Проверить тестовое", "Дать ответ кандидату"].map((item) => <option key={item} value={item} />)}</datalist>
        <label className="block text-sm font-medium">Срок ({state.timezone})<input aria-label="Срок действия" type="datetime-local" step={60} value={due} onChange={(event) => setDue(event.target.value)} required className={field} /></label>
        <label className="block text-sm font-medium">Комментарий<textarea aria-label="Комментарий к действию" value={comment} onChange={(event) => setComment(event.target.value)} rows={3} maxLength={3000} className={field} placeholder="Что нужно сделать или уточнить" /></label>
      </fieldset>
      <div className="flex flex-wrap gap-3"><button type="submit" disabled={busy || !title.trim() || !due} className={button}>{busy ? "Сохраняем…" : "Сохранить действие"}</button><button type="button" disabled={busy} onClick={cancel} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm">Отмена</button></div>
    </form> : <div className="mt-5 space-y-4">
      {task && <div><div className="flex flex-wrap items-center gap-3"><p className="font-medium">{task.title}</p><span style={{ backgroundColor: task.completed_at ? "#e8f5ec" : task.overdue ? "#fcebec" : "#e8f4fc", color: task.completed_at ? "#166534" : task.overdue ? "#991b1b" : "#075985", borderRadius: 999, padding: "4px 12px", fontSize: 12 }}>{task.completed_at ? "Выполнено" : task.overdue ? "Просрочено" : "Запланировано"}</span></div><p className="mt-2 text-sm text-slate-500">Срок: {date(task.due_at)}{task.completed_at ? ` · Выполнено: ${date(task.completed_at)}` : ""}</p>{task.comment && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{task.comment}</p>}</div>}
      <div className="flex flex-wrap gap-3">{task && !task.completed_at && <button type="button" disabled={busy} onClick={() => void send("complete")} className={button}>Выполнено</button>}<button type="button" disabled={busy} onClick={edit} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-indigo-700">{base ? "Перенести / редактировать" : "Запланировать действие"}</button></div>
    </div>}
    {state.history.length > 0 && <details className="mt-5 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm text-slate-500">История действий · последние {state.history.length} событий</summary><ol className="mt-3 divide-y divide-slate-100">{state.history.map((event) => <li key={event.id} className="py-3 text-sm"><p className="text-xs text-slate-500">{date(event.created_at)} · {event.action === "completed" ? "Выполнено" : event.action === "created" ? "Запланировано" : "Изменено"}</p><p className="mt-1 font-medium">{event.task.title}</p><p className="mt-1 text-slate-500">Срок: {date(event.task.due_at)}</p>{event.task.comment && <p className="mt-1 whitespace-pre-wrap break-words">{event.task.comment}</p>}</li>)}</ol></details>}
  </section>;
}
