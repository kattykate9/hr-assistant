"use client";
import { useActionState, useRef, useState } from "react";
export type JD = { id:number; title:string; direction:string; content:string; status:"draft"|"approved"; version:number; internal_notes?:string; template_inputs?:string };
export type SaveResult={error:string; saved?:boolean; approved?:boolean};
export type DraftResult={error:string; content?:string; questions?:string[]};
const sections=[
 ["purpose","Цель роли","Зачем компании нужен сотрудник?",3000],
 ["tasks","Основные задачи","Что сотрудник будет делать?",5000],
 ["results","Результаты за первые 3 месяца","Каких результатов ожидаете?",3000],
 ["required","Обязательные требования","Без каких навыков не справится?",5000],
 ["preferred","Будет плюсом","Желательные навыки и опыт",3000],
 ["team","Команда и подчинение","С кем работает, кому подчиняется?",2000],
 ["conditions","Условия","Только определённые условия: формат, график, зарплата",3000],
] as const;
type Inputs=Record<(typeof sections)[number][0],string>;
const empty:Inputs={purpose:"",tasks:"",results:"",required:"",preferred:"",team:"",conditions:""};
function readInputs(jd?:JD):Inputs { try {const raw=JSON.parse(jd?.template_inputs||"{}"); return Object.fromEntries(sections.map(([k])=>[k,typeof raw[k]==="string"?raw[k]:""])) as Inputs;}catch{return {...empty};} }
const field="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900";
const button="rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50";
export default function JDForm({jd,save,prepare}:{jd?:JD;save:(s:SaveResult,f:FormData)=>Promise<SaveResult>;prepare:(data:unknown)=>Promise<DraftResult>}) {
 const [result,submit,pending]=useActionState(save,{error:""});
 const [title,setTitle]=useState(jd?.title||""); const [direction,setDirection]=useState(jd?.direction||"traffic");
 const [inputs,setInputs]=useState<Inputs>(()=>readInputs(jd)); const [content,setContent]=useState(jd?.content||"");
 const [notes,setNotes]=useState(jd?.internal_notes||""); const [consent,setConsent]=useState(false);
 const [generating,setGenerating]=useState(false); const [error,setError]=useState(""); const [reviewed,setReviewed]=useState(false);
 const [message,setMessage]=useState(""); const [stale,setStale]=useState(false); const lock=useRef(false);
 const busy=pending||generating;
 function changed(){setReviewed(false);if(content)setStale(true);}
 async function generate(ai:boolean){
  if(busy||lock.current)return;
  if(!title.trim()||!inputs.purpose.trim()||!inputs.tasks.trim()){setError("Заполните название, цель роли и основные задачи.");return;}
  if(ai&&!consent){setError("Подтвердите передачу заполненных полей в OpenAI.");return;}
  if(content.trim()&&!window.confirm("Заменить текущий текст JD? При ошибке текст останется без изменений."))return;
  lock.current=true;setGenerating(true);setError("");setMessage("");
  try{
   let text="";
   if(ai){const r=await prepare({title:title.trim(),direction,inputs,share_with_openai:consent});
    if(r.error||!r.content){setError(r.error||"Не получен черновик.");return;}
    text=r.content;
    if(r.questions?.length)text+="\n\nВопросы для согласования:\n"+r.questions.map(q=>"• "+q).join("\n");
   }else{text=sections.map(([k,label])=>label+":\n"+(inputs[k].trim()||"Требует уточнения")).join("\n\n");}
   if(text.length>30000){setError("Черновик длиннее 30 000 символов. Сократите исходные данные.");return;}
   setContent(text);setReviewed(false);setStale(false);setMessage("Черновик готов. Проверьте текст ниже и сохраните его.");
  }catch{setError("Ответ не получен. Текст сохранён в форме. Повторная генерация может оплачиваться отдельно.");}
  finally{lock.current=false;setGenerating(false);}
 }
 if(result.saved)return <div role="status" className="rounded-xl bg-emerald-50 p-5"><p>{result.approved?"JD утверждён.":"JD сохранён."}</p><a href="/job-descriptions" className="mt-3 inline-block text-indigo-700 underline">Вернуться к списку JD →</a></div>;
 return <form action={submit} className="space-y-5">
  {jd&&<><input type="hidden" name="id" value={jd.id}/><input type="hidden" name="version" value={jd.version}/></>}
  <input type="hidden" name="template_inputs" value={JSON.stringify(inputs)}/>
  <fieldset disabled={busy} className="space-y-5">
   <label className="block text-sm font-medium">Название роли<input name="title" required maxLength={200} value={title} onChange={e=>{setTitle(e.target.value);changed();}} placeholder="Например, Маркетинг-инженер" className={field}/></label>
   <label className="block text-sm font-medium">Направление<select name="direction" value={direction} onChange={e=>{setDirection(e.target.value);changed();}} className={field}><option value="traffic">Маркетинг и трафик</option><option value="development">Программирование</option><option value="roblox">Roblox</option></select></label>
   <details open={!jd} className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
    <summary className="cursor-pointer font-semibold">Исходные данные по шаблону</summary>
    <p className="mt-3 text-sm text-slate-600">Для подготовки текста заполните цель роли и задачи. Неизвестные условия оставьте пустыми. Можно также вставить готовый JD в поле ниже.</p>
    <div className="mt-4 space-y-4">{sections.map(([k,label,placeholder,max])=><label key={k} className="block text-sm font-medium">{label}{(k==="purpose"||k==="tasks")?" *":""}<textarea maxLength={max} rows={3} value={inputs[k]} placeholder={placeholder} onChange={e=>{setInputs({...inputs,[k]:e.target.value});changed();}} className={field}/></label>)}</div>
    <label className="mt-5 flex items-start gap-3 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} className="mt-1"/>Разрешаю передать название, направление и заполненные поля шаблона в OpenAI. Запрос оплачивается через API.</label>
    <div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy||!consent} onClick={()=>generate(true)} className={button}>{generating?"Подготавливаем…":"Создать JD с ИИ"}</button><button type="button" disabled={busy} onClick={()=>generate(false)} className="rounded-xl border border-indigo-300 bg-white px-5 py-3 text-sm text-indigo-700">Собрать по шаблону без ИИ</button></div>
   </details>
   {error&&<p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{error}</p>}
   <p role="status" className="text-sm text-indigo-700">{generating?"Дождитесь ответа, не закрывая страницу.":message}</p>
   {stale&&<p className="text-sm text-amber-800">Исходные данные изменены. Обновите текст JD вручную или подготовьте его заново.</p>}
   <label className="block text-sm font-medium">Текст Job Description<textarea name="content" required minLength={20} maxLength={30000} rows={16} value={content} onChange={e=>{setContent(e.target.value);setReviewed(false);}} placeholder="Здесь появится черновик. Можно вставить готовый JD." className={field}/></label>
   <label className="block text-sm font-medium">Внутренние комментарии рекрутера<textarea name="internal_notes" maxLength={10000} rows={4} value={notes} onChange={e=>{setNotes(e.target.value);setReviewed(false);}} placeholder="Отдельные заметки для рекрутера" className={field}/></label>
   <p className="text-xs text-slate-500">Это поле сохраняется отдельно: не передаётся в OpenAI и не включается в текст вакансии. Конфиденциальные комментарии из старых JD перенесите сюда вручную.</p>
   {jd&&<label className="flex items-start gap-3 text-sm"><input type="checkbox" name="approvalConfirmed" value="yes" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} required/>Я проверила текст и подтверждаю изменения.</label>}
   {result.error&&<p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm">{result.error}</p>}
   <div className="flex flex-wrap gap-3"><button type="submit" name="intent" value="save" disabled={busy} className={button}>{pending?"Сохраняем…":jd?"Сохранить изменения":"Сохранить черновик"}</button>{jd&&<button type="submit" name="intent" value="approve" disabled={busy} className="rounded-xl border border-indigo-300 px-5 py-3 text-sm text-indigo-700">Сохранить и утвердить JD</button>}</div>
   {jd&&<p className="text-xs text-slate-500">После утверждения редактирование этой версии будет закрыто.</p>}
  </fieldset>
 </form>;
}
