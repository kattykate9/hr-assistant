"use server";
import { headers } from "next/headers";
import type { AIAction } from "./ai-types";
async function request(id:number,body?:unknown):Promise<AIAction>{
 if(!Number.isSafeInteger(id)||id<1)return {error:"Некорректный отклик."};
 try{
  const response=await fetch(`http://127.0.0.1:8000/recruiting/applications/${id}/ai-assessment`,{method:body?"POST":"GET",headers:{Authorization:(await headers()).get("authorization")??"","Content-Type":"application/json","X-HR-Action":"candidate-workflow"},...(body?{body:JSON.stringify(body)}:{}),cache:"no-store",signal:AbortSignal.timeout(body?90000:10000)});
  const data=await response.json().catch(()=>null);
  if(!response.ok)return {error:typeof data?.detail==="string"?data.detail:"AI-анализ недоступен. Проверьте вход в кабинет и backend."};
  if(typeof data?.fingerprint!=="string"||typeof data.available!=="boolean")return {error:"Некорректный ответ сервера. Обновите статус."};
  return {data};
 }catch{return {error:"Ответ не получен. Нажмите «Обновить статус» перед новой попыткой: анализ мог сохраниться. Повторный запрос может оплачиваться отдельно."};}
}
export async function readAI(id:number){return request(id);}
export async function analyzeAI(id:number,body:{request_id:string;fingerprint:string;share_with_openai:boolean}){return request(id,body);}
