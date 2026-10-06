"use server";
import { headers } from "next/headers";
export async function downloadExport(payload: {mode: "selected" | "filtered"; fields: string[]; ids: number[]; filters: Record<string,string | number> }): Promise<{csv?:string; count?:number; error?:string}> {
  const auth=(await headers()).get("authorization");
  if (!auth) return {error:"Войдите в кабинет заново."};
  try {
    const response=await fetch("http://127.0.0.1:8000/recruiting/export",{method:"POST",headers:{Authorization:auth,"Content-Type":"application/json","X-HR-Action":"candidate-workflow"},body:JSON.stringify(payload),cache:"no-store",signal:AbortSignal.timeout(30000)});
    if (!response.ok) {
      if ([409,413,422].includes(response.status)) { const data=await response.json(); if(typeof data.detail==="string")return {error:data.detail}; }
      return {error: [401,403].includes(response.status)?"Нет доступа. Войдите в кабинет заново.":"Экспорт не выполнен. Проверьте фильтры и повторите."};
    }
    return {csv:await response.text(),count:Number(response.headers.get("X-Export-Count"))};
  } catch {return {error:"Сервер не ответил. Попробуйте сузить фильтры и повторить экспорт."};}
}
