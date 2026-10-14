import Link from "next/link";
import { apiFetch, API_URL } from "@/lib/api";
export const dynamic = "force-dynamic";
type Vacancy={id:number;title:string;description:string;direction:string;criteria:string[];preferred_criteria?:string[];vacancy_status:"active"|"archived";source_jd_id?:number|null;language?:string|null};
export default async function VacancyPage({params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 let vacancy:Vacancy|undefined;let failed=false;
 if(/^[1-9]\d*$/.test(id)){
  try{
   const response=await apiFetch(`${API_URL}/vacancies?include_archived=true`,{headers:{},cache:"no-store",signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error("Unavailable");
   const items=await response.json();if(!Array.isArray(items))throw new Error("Invalid data");
   vacancy=items.find((v:Vacancy)=>v.id===Number(id));
  }catch{failed=true;}
 }
 return <main className="min-h-screen bg-slate-50 px-5 py-10 font-sans text-slate-900"><div className="mx-auto max-w-4xl space-y-6">
  <nav className="flex flex-wrap gap-5 text-sm text-indigo-600"><Link href="/job-descriptions">← К Job Description</Link><Link href="/#vacancies">К списку вакансий</Link></nav>
  {!vacancy?<p role="alert" className="rounded-xl bg-amber-50 p-5">{failed?"Не удалось загрузить вакансию. Проверьте вход в кабинет и обновите страницу.":"Вакансия не найдена."}</p>:<>
   <header className="space-y-3"><h1 className="text-3xl font-semibold">{vacancy.title}</h1><p><span className={vacancy.vacancy_status==="archived"?"rounded-full bg-slate-200 px-3 py-1 text-sm text-slate-600":"rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-800"}>{vacancy.vacancy_status==="archived"?"В архиве":"Активна"}</span></p>
   <Link href={`/applications?vacancy_id=${vacancy.id}`} className="inline-block rounded-xl bg-indigo-600 px-5 py-3 text-sm text-white">Отклики на вакансию →</Link></header>
   {vacancy.vacancy_status==="archived"&&<p className="text-sm text-slate-600">Вакансия закрыта. Отклики и история сохранены. Возобновить её можно в разделе «Вакансии» на вкладке «Архив».</p>}
   <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold">Описание</h2><p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">{vacancy.description}</p></section>
   <section className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold">Обязательные критерии</h2><ul className="mt-4 list-disc space-y-2 pl-5 text-sm">{vacancy.criteria.map((c,i)=><li key={i}>{c}</li>)}</ul>
   {!!vacancy.preferred_criteria?.length&&<><h2 className="mt-6 text-lg font-semibold">Желательные критерии</h2><ul className="mt-4 list-disc space-y-2 pl-5 text-sm">{vacancy.preferred_criteria.map((c,i)=><li key={i}>{c}</li>)}</ul></>}</section>
  </>}
 </div></main>;
}
