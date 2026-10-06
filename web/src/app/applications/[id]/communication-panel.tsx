"use client";
import TelegramSendPanel from "./telegram-send-panel";
import { useRef, useState } from "react";
const kinds={interview:"Приглашение на интервью",test:"Тестовое задание",questions:"Уточняющие вопросы",rejection:"Отказ"};
type Kind=keyof typeof kinds;
function draft(kind:Kind,name:string,vacancy:string) {
 const greeting=`Здравствуйте, ${name}!`;
 const texts={
 interview:{subject:`Интервью на вакансию «${vacancy}»`,body:`${greeting}\n\nСпасибо за интерес к вакансии «${vacancy}». Хотим пригласить вас на интервью.\n\nДата и время с часовым поясом: [укажите дату, время и часовой пояс]\nФормат и место или ссылка: [укажите детали встречи]\n\nПодскажите, пожалуйста, удобно ли вам это время?`},
 test:{subject:`Тестовое задание — «${vacancy}»`,body:`${greeting}\n\nПредлагаем следующий этап по вакансии «${vacancy}» — тестовое задание.\n\nЗадание: [вставьте описание или ссылку]\nОжидаемый объём работы: [укажите примерную длительность]\nСрок и способ отправки результата: [укажите срок с часовым поясом и способ отправки]\n\nПодскажите, пожалуйста, готовы ли вы выполнить задание и подходит ли срок?`},
 questions:{subject:`Вопросы по вакансии «${vacancy}»`,body:`${greeting}\n\nСпасибо за отклик на вакансию «${vacancy}». Хотели бы уточнить несколько деталей:\n\n[напишите вопросы]\n\nБудем благодарны за ответ.`},
 rejection:{subject:`Обратная связь по вакансии «${vacancy}»`,body:`${greeting}\n\nСпасибо за интерес к вакансии «${vacancy}» и уделённое время. По итогам рассмотрения мы решили не продолжать подбор с вашей кандидатурой на эту позицию.\n\nБлагодарим за общение и желаем успехов в поиске подходящей работы.`}
 };return texts[kind];
}
export default function CommunicationPanel({id,name,vacancy}:{id:number;name:string;vacancy:string|null}) {
 const [open,setOpen]=useState(false),[kind,setKind]=useState<Kind>('interview');
 const [drafts,setDrafts]=useState<Partial<Record<Kind,{subject:string;body:string}>>>({});
 const [feedback,setFeedback]=useState(''),[busy,setBusy]=useState(false);const area=useRef<HTMLTextAreaElement>(null);
 const current=drafts[kind]??draft(kind,name,vacancy??'уточните вакансию');
 const incomplete=/\[[^\]]+\]/.test(current.body);
 function edit(key:'subject'|'body',value:string){setDrafts(v=>({...v,[kind]:{...current,[key]:value}}));setFeedback('');}
 async function copy(){setBusy(true);setFeedback('');try{await navigator.clipboard.writeText(current.body);setFeedback('Текст скопирован. Отправьте его кандидату в нужном канале.');}catch{area.current?.focus();area.current?.select();setFeedback('Автокопирование недоступно. Текст выделен — нажмите ⌘C на Mac или Ctrl+C.');}finally{setBusy(false);}}
 return <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><button type="button" onClick={()=>setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 text-left text-lg font-semibold"><span>Шаблоны коммуникации</span><span aria-hidden="true">{open?'−':'+'}</span></button>
 {open&&<div className="mt-4 space-y-4"><p className="text-sm text-slate-500">Подготовьте текст: его можно скопировать или отправить через Telegram-бота с отдельным подтверждением. Черновики сохраняются только до перезагрузки или ухода со страницы.</p>
 <label className="block text-sm font-medium">Шаблон<select value={kind} onChange={e=>{setKind(e.target.value as Kind);setFeedback('');}} className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3">{Object.entries(kinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
 <p className="text-sm text-slate-500">Для: {name} · Вакансия: {vacancy??'не указана'}</p>
 <label className="block text-sm font-medium">Тема письма (для почты)<input value={current.subject} maxLength={300} onChange={e=>edit('subject',e.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 p-3" /></label>
 <label className="block text-sm font-medium">Текст сообщения<textarea ref={area} value={current.body} maxLength={10000} onChange={e=>edit('body',e.target.value)} rows={12} className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-sm leading-6" /></label>
 {incomplete&&<p className="text-sm text-amber-800">Перед копированием замените подсказки в квадратных скобках.</p>}
 <div className="flex flex-wrap gap-3"><button type="button" disabled={busy||incomplete||!current.body.trim()} onClick={()=>void copy()} className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm text-white disabled:opacity-50">{busy?'Копируем…':'Скопировать текст'}</button><button type="button" onClick={()=>{if(window.confirm('Восстановить исходный текст этого шаблона? Ваши правки в нём будут удалены.')){setDrafts(v=>({...v,[kind]:draft(kind,name,vacancy??'уточните вакансию')}));setFeedback('');}}} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm">Сбросить этот шаблон</button></div>
 {feedback&&<p role="status" className="text-sm text-slate-600">{feedback}</p>}
 <TelegramSendPanel id={id} text={current.body} incomplete={incomplete} />
 </div>}</section>;
}
