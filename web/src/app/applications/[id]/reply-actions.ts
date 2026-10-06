"use server";
import { headers } from "next/headers";
export async function saveReply(id:number,needs_reply:boolean,version:number):Promise<{data?:{needs_reply:boolean;version:number;updated_at:string|null};error?:string}>{
  if(!Number.isSafeInteger(id)||id<1||!Number.isSafeInteger(version)||version<0)return {error:"Некорректный запрос."};
  try{
    const auth=(await headers()).get("authorization");if(!auth)return {error:"Войдите в кабинет."};
    const response=await fetch(`http://127.0.0.1:8000/recruiting/applications/${id}/reply`,{method:"PUT",headers:{Authorization:auth,"Content-Type":"application/json","X-HR-Action":"candidate-workflow"},body:JSON.stringify({needs_reply,version}),cache:"no-store",signal:AbortSignal.timeout(10000)});
    if(response.ok)return {data:await response.json()};
    return {error:response.status===409?"Отметка изменена в другой вкладке. Обновите карточку.":"Не удалось сохранить отметку. Обновите карточку и проверьте вход."};
  }catch{return {error:"Нет подтверждения сервера. Обновите карточку перед повтором."};}
}
