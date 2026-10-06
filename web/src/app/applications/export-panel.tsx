"use client";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { downloadExport } from "./export-actions";
const fields = {id:"ID отклика",name:"ФИО",vacancy_title:"Вакансия",contact:"Контакт",source:"Источник",created_at:"Дата отклика",status:"Этап подбора",match_percent:"Оценка по критериям, %",resume_text:"Текст резюме",notes:"Заметки по этапам"};
const Selection=createContext<{ids:number[]; toggle:(id:number)=>void; busy:boolean}>({ids:[],toggle:()=>{},busy:false});
export function ExportChoice({id,name,blocked}:{id:number;name:string;blocked:boolean}) {
  const {ids,toggle,busy}=useContext(Selection);
  return <label className="mb-2 flex items-center gap-2 text-xs text-slate-500"><input type="checkbox" checked={ids.includes(id)} onChange={()=>toggle(id)} disabled={blocked||busy} aria-label={`Выбрать для экспорта: ${name}`} />{blocked?"hh.ru — пока без экспорта":"Выбрать для экспорта"}</label>;
}
export default function ExportPanel({query,total,choices,children}:{query:string;total:number;choices:{id:number;name:string;source:string}[];children:ReactNode}) {
  const [ids,setIds]=useState<number[]>([]),[open,setOpen]=useState(false),[mode,setMode]=useState<"selected"|"filtered">("filtered"),[selected,setSelected]=useState<string[]>(Object.keys(fields).filter(k=>!["resume_text","notes"].includes(k))),[busy,setBusy]=useState(false),[error,setError]=useState(""),[message,setMessage]=useState("");
  const lock=useRef(false);
  const toggle=(id:number)=>setIds(a=>a.includes(id)?a.filter(x=>x!==id):[...a,id]);
  async function save() {
    if(lock.current)return;lock.current=true;setBusy(true);setError("");setMessage("");
    try {
      const params=new URLSearchParams(query),filters:Record<string,string|number>={};
      for(const key of ["status","vacancy_id","source","q","assessment","sort","created_from","created_before"]) {const value=params.get(key);if(value)filters[key]=key==="vacancy_id"?Number(value):value;}
      const result=await downloadExport({mode,fields:selected,ids:mode==="selected"?ids:[],filters});
      if(result.error)setError(result.error);
      else if(result.csv!==undefined) {
        const csv=result.csv.startsWith("\ufeff")?result.csv:"\ufeff"+result.csv;
        const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
        const a=document.createElement("a");a.href=url;a.download="applications.csv";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
        setMessage(`Файл подготовлен: ${result.count} откликов. Проверьте папку загрузок.`);
      }
    } catch {setError("Не удалось скачать файл. Повторите экспорт.");}
    finally {lock.current=false;setBusy(false);}
  }
  return <Selection.Provider value={{ids,toggle,busy}}><section className="rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={()=>setOpen(!open)} aria-expanded={open} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white">Экспорт CSV</button><span className="text-sm text-slate-500">Выбрано на странице: {ids.length}</span><button type="button" disabled={busy} className="text-sm text-indigo-700" onClick={()=>setIds(choices.filter(x=>x.source!=="hh").map(x=>x.id))}>Выбрать доступные на странице</button><button type="button" disabled={busy} className="text-sm text-slate-500" onClick={()=>setIds([])}>Снять выбор</button></div>
    {open&&<div className="mt-4 space-y-4"><p className="text-sm text-slate-500">Отклики hh.ru пока исключены. Выбор сбрасывается при переходе на другую страницу или применении фильтров.</p>
    <fieldset className="space-y-2 text-sm"><legend className="mb-2 font-medium">Какие отклики выгрузить</legend><label className="block"><input type="radio" name="export-mode" checked={mode==="filtered"} onChange={()=>setMode("filtered")} /> Все по применённым фильтрам, со всех страниц (найдено {total}, включая hh)</label><label className="block"><input type="radio" name="export-mode" checked={mode==="selected"} onChange={()=>setMode("selected")} /> Выбранные на этой странице: {ids.length}</label></fieldset>
    <fieldset><legend className="mb-2 text-sm font-medium">Поля файла</legend><div className="grid gap-3 sm:grid-cols-2">{Object.entries(fields).map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={selected.includes(key)} onChange={()=>setSelected(a=>a.includes(key)?a.filter(x=>x!==key):[...a,key])} />{label}</label>)}</div></fieldset>
    <p className="text-xs text-slate-500">CSV UTF-8, разделитель — запятая. Даты — с часовым поясом UTC. Без оценки — пустая ячейка. До 2000 откликов за раз. Это выгрузка полей, без исходных PDF/DOC-файлов.</p>
    <button type="button" disabled={busy||!selected.length||(mode==="selected"&&!ids.length)} onClick={()=>void save()} className="rounded-xl bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy?"Готовим файл…":"Скачать CSV"}</button>
    </div>}{error&&<p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}{message&&<p role="status" className="mt-3 text-sm text-green-800">{message}</p>}
  </section>{children}</Selection.Provider>;
}
