"use client";
import { useRef,useState } from "react";
import { saveReply } from "./reply-actions";
export default function ReplyPanel({id,initial}:{id:number;initial:{needs_reply:boolean;version:number;updated_at:string|null}}){
 const [value,setValue]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 async function toggle(){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const result=await saveReply(id,!value.needs_reply,value.version);if(result.data)setValue(result.data);else setError(result.error??'Не удалось сохранить.');}catch{setError('Обновите карточку и проверьте отметку.');}finally{lock.current=false;setBusy(false);}}
 return <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold">Ответ кандидату</h2><p role="status" className="mt-2 text-sm" style={{color:value.needs_reply?'#9a3412':'#475569'}}>{value.needs_reply?'Ожидает ответа от нас':'Не отмечен как ожидающий ответа'}</p><p className="mt-2 text-xs text-slate-500">Ручная отметка для отчётов. Копирование шаблона и изменение этапа её не снимают. Сообщение кандидату не отправляется.</p><button type="button" disabled={busy} onClick={()=>void toggle()} className="mt-4 rounded-xl border border-slate-300 px-4 py-2.5 text-sm disabled:opacity-50">{busy?'Сохраняем…':value.needs_reply?'Снять отметку':'Отметить: нужно ответить'}</button>{error&&<p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}</section>;
}
