"use server";
import { headers } from "next/headers";
export type OutgoingMessage={request_id:string;text:string;status:string;detail:string;created_at:string;updated_at:string};
export type MessageHistory={available:boolean;recipient:string;chat_id:string|null;reason:string;items:OutgoingMessage[]};
export type MessagePreview={message:OutgoingMessage;recipient:string;chat_id:string;channel:string};
async function call(id:number,path:string,body?:unknown){
 if(!Number.isSafeInteger(id)||id<1)throw new Error('Некорректный отклик');
 const auth=(await headers()).get('authorization');if(!auth)throw new Error('Войдите в кабинет');
 const r=await fetch(`http://127.0.0.1:8000/recruiting/applications/${id}/messages${path}`,{method:body===undefined?'GET':'POST',headers:{Authorization:auth,'Content-Type':'application/json','X-HR-Action':'candidate-workflow'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(25000)});
 if(!r.ok){const d=await r.json().catch(()=>({}));throw new Error(typeof d.detail==='string'?d.detail:'Не удалось выполнить запрос. Проверьте вход и обновите историю.');}return r.json();
}
export async function getMessages(id:number):Promise<{data?:MessageHistory;error?:string}>{try{return {data:await call(id,'')}}catch{return {error:'История недоступна. Проверьте сервер и обновите историю.'}}}
export async function prepareMessage(id:number,text:string):Promise<{data?:MessagePreview;error?:string}>{try{return {data:await call(id,'/prepare',{text})}}catch(e){return {error:e instanceof Error?e.message:'Не удалось подготовить сообщение'}}}
export async function sendMessage(id:number,requestId:string):Promise<{data?:OutgoingMessage;error?:string}>{
 if(!/^[a-f0-9-]{36}$/i.test(requestId))return {error:'Некорректный предпросмотр'};
 try{return {data:await call(id,`/${requestId}/send`,{confirmed:true})}}catch{return {error:'Нет подтверждения результата. Обновите историю; сообщение могло уйти. Повтор не выполняется.'}}
}
