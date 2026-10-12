"use client";
import { useRef,useState } from "react";
import AIBadge from "../ai-badge";
import { analyzeAI,readAI } from "./ai-actions";
import type { AIState } from "./ai-types";
const labels={confirmed:"Подтверждён",partial:"Частично подтверждён",not_confirmed:"Не подтверждён резюме",not_applicable:"Исключён из расчёта"};
const categories={experience:"Опыт",skills:"Навыки",projects:"Проекты и результаты"};
export default function AIPanel({id,initial,timezone}:{id:number;initial:AIState;timezone:string}){
 const [data,setData]=useState(initial);const [busy,setBusy]=useState(false);const [consent,setConsent]=useState(false);const [error,setError]=useState("");const [uncertain,setUncertain]=useState(false);const lock=useRef(false);
 const result=data?.result;const current=!!result&&!data.stale;const running=data?.run?.status==="running";
 async function run(analyze:boolean){
  if(lock.current)return;
  if(analyze&&(!consent||!data.available||current||running||uncertain))return;
  if(analyze&&data.run&&data.run.status!=="completed"&&!window.confirm("Предыдущая попытка не завершилась успешно. Новый запрос может оплачиваться отдельно. Повторить анализ?"))return;
  lock.current=true;setBusy(true);setError("");
  try{
   const response=analyze?await analyzeAI(id,{request_id:crypto.randomUUID(),fingerprint:data.fingerprint,share_with_openai:consent}):await readAI(id);
   if(response.data){setData(response.data);setUncertain(false);}else{setError(response.error||"Ответ не получен.");if(analyze)setUncertain(true);}
  }catch{setError("Ответ не получен. Обновите статус перед повторной попыткой.");if(analyze)setUncertain(true);}
  finally{lock.current=false;setBusy(false);}
 }
 return <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" aria-busy={busy}>
  <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">AI-оценка по критериям вакансии</h2><AIBadge value={{percent:result?.percent??null,has_assessment:!!result,stale:data?.stale??false}}/></div>
  <p className="text-sm leading-6 text-slate-600">Предварительный разбор только по резюме. Отсутствие сведений не означает отсутствие навыка. Решение принимает рекрутер; ручная оценка и этап подбора не изменяются.</p>
  {data?.stale&&<p role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Резюме или вакансия изменились. Ниже — предыдущий анализ, он устарел. Нужен новый анализ.</p>}
  {!data?.available&&<p className="text-sm text-amber-800">{data?.reason||"Обновите статус, чтобы загрузить AI-блок."}</p>}
  {!current&&<label className="flex items-start gap-3 text-sm text-slate-600"><input type="checkbox" checked={consent} disabled={busy||running} onChange={e=>setConsent(e.target.checked)} className="mt-1"/>Разрешаю передать текст резюме и требования этой вакансии в OpenAI для анализа. Запрос оплачивается через API.</label>}
  <div className="flex flex-wrap gap-3">{!current&&<button type="button" disabled={busy||running||uncertain||!consent||!data?.available} onClick={()=>run(true)} className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{busy?"Подождите…":result?"Обновить AI-анализ":"Проанализировать резюме"}</button>}<button type="button" disabled={busy} onClick={()=>run(false)} className="rounded-xl border border-slate-300 px-4 py-3 text-sm disabled:opacity-50">Обновить статус</button></div>
  {running&&<p role="status" className="text-sm text-indigo-700">Анализ выполняется. Через некоторое время нажмите «Обновить статус» — новый платный запрос не отправится.</p>}
  {error&&<p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}
  {data?.run?.detail&&<p className="text-sm text-amber-800">{data.run.detail}</p>}
  {result&&<>
   <div><h3 className="font-semibold">Краткая выжимка</h3>{result.facts.length?<ul className="mt-3 space-y-3">{result.facts.map((fact,i)=><li key={i} className="rounded-xl bg-slate-50 p-4 text-sm"><span className="text-xs font-medium text-indigo-700">{categories[fact.category]}</span><p className="mt-1 leading-6">{fact.text}</p><details className="mt-2"><summary className="cursor-pointer text-slate-500">Подтверждение в резюме</summary><blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-indigo-200 pl-3 text-slate-600">{fact.evidence}</blockquote></details></li>)}</ul>:<p className="mt-2 text-sm text-slate-500">В резюме не найдено подтверждённых фактов для краткой выжимки.</p>}</div>
   <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-50"><tr><th className="p-3">Критерий вакансии</th><th className="p-3">Результат</th><th className="p-3">Подтверждение и пояснение</th><th className="p-3">Что уточнить</th></tr></thead><tbody>{result.answers.map(a=><tr key={a.key} className="border-t border-slate-200 align-top"><td className="p-3"><p>{a.criterion}</p><p className="mt-1 text-xs text-slate-500">{a.kind==="required"?"Обязательный":"Желательный"}</p></td><td className="p-3">{labels[a.rating]}</td><td className="p-3"><p>{a.explanation}</p>{a.evidence&&<blockquote className="mt-2 whitespace-pre-wrap border-l-2 border-indigo-200 pl-3 text-slate-500">{a.evidence}</blockquote>}</td><td className="p-3">{a.question||"—"}</td></tr>)}</tbody></table></div>
   <p className="text-xs leading-5 text-slate-500">Расчёт: (подтверждённые + 0,5 × частично подтверждённые) / число оцениваемых критериев × 100%. Все критерии имеют одинаковый вес. В расчёте: {result.total}; исключено: {result.excluded}. Это показатель подтверждения требований резюме, не вероятность успешного найма.</p>
   <p className="text-xs text-slate-500">{data.updated_at?new Intl.DateTimeFormat("ru-RU",{timeZone:timezone,dateStyle:"short",timeStyle:"short"}).format(new Date(data.updated_at)):""} · {timezone} · Модель: {data.model}</p>
  </>}
 </section>;
}
