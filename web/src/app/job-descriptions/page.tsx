import Link from "next/link";
import { apiFetch, API_URL } from "@/lib/api";
import JDForm, { type SaveResult, type DraftResult } from "./jd-form";

export const dynamic = "force-dynamic";

const API = `${API_URL}/job-descriptions`;

type LinkedVacancy = { id: number; title: string; source_jd_id?: number | null; source_jd_version?: number | null; vacancy_status: "active" | "archived" };

type JD = {
  id: number;
  title: string;
  direction: string;
  content: string;
  status: "draft" | "approved";
  version: number;
  internal_notes?: string;
  template_inputs?: string | Record<string,string>;
};

const directions: Record<string, string> = {
  traffic: "Арбитраж трафика",
  development: "Программирование",
  roblox: "Roblox",
};

async function saveJD(previous: SaveResult, form: FormData): Promise<SaveResult> {
  "use server";
  const id=String(form.get("id")??"");
  if(id&&!/^[1-9]\d*$/.test(id))return {error:"Некорректный ID."};
  if(id&&form.get("approvalConfirmed")!=="yes")return {error:"Подтвердите проверку текста."};
  let inputs;
  try{inputs=JSON.parse(String(form.get("template_inputs")||"{}"));}catch{return {error:"Некорректный шаблон."};}
  const approve=form.get("intent")==="approve";
  try{
    const response=await apiFetch(id?`${API}/${id}`:API,{
      method:id?"PUT":"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({title:String(form.get("title")??"").trim(),direction:String(form.get("direction")??""),
        content:String(form.get("content")??"").trim(),internal_notes:String(form.get("internal_notes")??""),template_inputs:inputs,
        ...(id?{version:Number(form.get("version")),approve}: {})}),cache:"no-store",signal:AbortSignal.timeout(15000)});
    if(response.ok)return {error:"",saved:true,approved:!!id&&approve};
    const messages:Record<number,string>={401:"Войдите в кабинет заново.",403:"Нет доступа.",404:"JD не найден.",409:"JD уже изменён или утверждён. Скопируйте свои правки и обновите страницу.",422:"Проверьте длину и заполнение полей."};
    return {error:messages[response.status]||"Не удалось сохранить JD. Введённый текст остался в форме."};
  }catch{return {error:"Нет подтверждения сохранения. Перед повторной отправкой проверьте список JD в другой вкладке: документ мог сохраниться. Текст остался в форме."};}
}
async function prepareJD(payload: unknown): Promise<DraftResult> {
  "use server";
  try{
    const response=await apiFetch(`${API}/ai-draft`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store",signal:AbortSignal.timeout(90000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok)return {error:typeof data?.detail==="string"?data.detail:"Не удалось подготовить JD. Проверьте заполнение полей и вход в кабинет."};
    if(typeof data?.content!=="string"||!Array.isArray(data.questions)||data.questions.some((q:unknown)=>typeof q!=="string"))return {error:"Некорректный ответ. Текст не изменён."};
    return {error:"",content:data.content,questions:data.questions};
  }catch{return {error:"Ответ ИИ не получен. Поля не изменены. Автоматического повтора нет; повторный запрос может оплачиваться отдельно."};}
}

export default async function JDPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const { result } = await searchParams;
  let items: JD[] = [];
  let failed = false;
  let vacancies: LinkedVacancy[] | null = null;
  try {
    const response = await apiFetch(`${API_URL}/vacancies?include_archived=true`, {
      headers: { },
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data) && data.every(v => Number.isInteger(v.id) && typeof v.title === "string" && ["active", "archived"].includes(v.vacancy_status))) vacancies = data;
    }
  } catch { vacancies = null; }

  try {
    const response = await apiFetch(API, {
      headers: {
        
      },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error("Unavailable");

    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("Invalid response");
    items = data;
  } catch {
    failed = true;
  }

  const messages: Record<string, string> = {
    saved: "Черновик сохранён.",
    approved: "JD утверждён. Эта версия закрыта для редактирования.",
    conflict:
      "Документ уже изменён или утверждён. Ниже показана актуальная версия.",
    validation:
      "Проверьте поля: название обязательно, текст — от 20 до 30 000 символов.",
    error: "Сервер не подтвердил сохранение. Проверьте состояние документа.",
    network:
      "Ответ сервера не получен. Перед повторной отправкой проверьте список: документ мог сохраниться.",
  };

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 font-sans text-slate-900">
      <div className="mx-auto max-w-4xl space-y-8">
        <Link href="/" className="text-sm font-medium text-indigo-600">
          ← В кабинет
        </Link>

        <header>
          <p className="text-sm text-indigo-600">Подготовка подбора</p>
          <h1 className="mt-2 text-3xl font-semibold">Job Description</h1>
          <p className="mt-3 text-slate-500">
            Сначала согласуем роль и требования, затем создадим вакансию.
          </p>
        </header>

        {result && messages[result] && (
          <div
            role="status"
            className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm"
          >
            {messages[result]}
          </div>
        )}

        {failed ? (
          <div role="alert" className="rounded-xl bg-amber-50 p-5 text-amber-900">
            Не удалось загрузить JD. Проверьте Python-сервер и подключение
            нового модуля, затем обновите страницу.
          </div>
        ) : (
          <>
            <details className="rounded-2xl border border-slate-200 bg-white p-6">
              <summary className="cursor-pointer text-lg font-semibold">
                + Создать Job Description
              </summary>
              <div className="mt-6">
                <JDForm save={saveJD} prepare={prepareJD} />
              </div>
            </details>

            <section className="space-y-4">
              <h2 className="text-xl font-semibold">
                Документы · {items.length}
              </h2>

              {items.length === 0 && (
                <p className="text-slate-500">
                  Пока нет JD. Создайте первый черновик выше.
                </p>
              )}

              {items.map((jd) => (
                <details
                  key={`${jd.id}-${jd.version}`}
                  className="rounded-2xl border border-slate-200 bg-white p-6"
                >
                  <summary className="cursor-pointer">
                    <span className="font-semibold">{jd.title}</span>
                    <span className="ml-3 text-sm text-slate-500">
                      №{jd.id} · Версия {jd.version} ·{" "}
                      {jd.status === "approved" ? "Утверждён" : "Черновик"}
                    </span>
                  </summary>

                  <div className="mt-6">
                    {jd.status === "draft" ? (
                      <JDForm jd={jd} save={saveJD} prepare={prepareJD} />
                    ) : (
                      <>
                        <p className="text-sm text-indigo-600">
                          {directions[jd.direction] ?? jd.direction}
                        </p>
                        <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">
                          {jd.content}
                        </p>
                        {jd.internal_notes && <details className="mt-4 rounded-xl bg-amber-50 p-4"><summary className="cursor-pointer font-medium">Внутренние комментарии</summary><p className="mt-3 whitespace-pre-wrap text-sm">{jd.internal_notes}</p></details>}
                        <p className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                          {vacancies === null ? (
                            <span>Не удалось проверить связанную вакансию. Обновите страницу.</span>
                          ) : (() => {
                            const linked = vacancies.find(v => v.source_jd_id === jd.id && v.source_jd_version === jd.version);
                            return linked ? <>
                              <span className="mb-2 block font-medium text-slate-700">{linked.vacancy_status === "archived" ? "Вакансия в архиве" : "Вакансия создана"}</span>
                              <Link href={`/vacancies/${linked.id}`} className="font-medium text-indigo-600">Открыть вакансию {linked.title} →</Link>
                            </> : <Link href={`/job-descriptions/${jd.id}/vacancy`} className="font-medium text-indigo-600">Создать вакансию на основе JD →</Link>;
                          })()}
                        </p>
                      </>
                    )}
                  </div>
                </details>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}