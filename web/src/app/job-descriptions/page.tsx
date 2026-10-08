import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const API = `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/job-descriptions`;

type JD = {
  id: number;
  title: string;
  direction: string;
  content: string;
  status: "draft" | "approved";
  version: number;
};

const directions: Record<string, string> = {
  traffic: "Арбитраж трафика",
  development: "Программирование",
  roblox: "Roblox",
};

const template = `Цель роли:
Зачем компании нужен этот сотрудник?

Основные задачи:
Какие задачи он будет выполнять?

Ожидаемые результаты:
Что должно быть сделано за первые 3 месяца?

Обязательные требования:
Без каких навыков невозможно выполнять работу?

Желательные требования:
Что будет преимуществом?

Команда и подчинение:
С кем работает сотрудник и кто его руководитель?

Условия:
Формат работы, график, часовой пояс, язык, бюджет.

Вопросы для согласования:
Какая информация пока не определена?`;

async function saveJD(form: FormData) {
  "use server";

  const id = String(form.get("id") ?? "");
  const intent = String(form.get("intent") ?? "save");

  const payload = {
    title: String(form.get("title") ?? "").trim(),
    direction: String(form.get("direction") ?? ""),
    content: String(form.get("content") ?? "").trim(),
    ...(id
      ? {
          version: Number(form.get("version")),
          approve: intent === "approve",
        }
      : {}),
  };

  const authorization = (await headers()).get("authorization") ?? "";
  let result = "network";

  try {
    const response = await fetch(
      id ? `${API}/${encodeURIComponent(id)}` : API,
      {
        method: id ? "PUT" : "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );

    if (response.ok) {
      result = intent === "approve" ? "approved" : "saved";
    } else if (response.status === 409) {
      result = "conflict";
    } else if (response.status === 422) {
      result = "validation";
    } else {
      result = "error";
    }
  } catch {
    result = "network";
  }

  redirect(`/job-descriptions?result=${result}`);
}

const field =
  "mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900";
const button =
  "rounded-xl bg-indigo-600 px-5 py-3 text-sm font-medium text-white hover:bg-indigo-700";

function JDForm({ jd }: { jd?: JD }) {
  return (
    <form action={saveJD} className="space-y-5">
      {jd && (
        <>
          <input type="hidden" name="id" value={jd.id} />
          <input type="hidden" name="version" value={jd.version} />
        </>
      )}

      <label className="block text-sm font-medium">
        Название роли
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={jd?.title ?? ""}
          placeholder="Например, Roblox Developer"
          className={field}
        />
      </label>

      <label className="block text-sm font-medium">
        Направление
        <select
          name="direction"
          defaultValue={jd?.direction ?? "roblox"}
          className={field}
        >
          {Object.entries(directions).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm font-medium">
        Внутренний Job Description
        <textarea
          name="content"
          required
          minLength={20}
          maxLength={30000}
          rows={16}
          defaultValue={jd?.content ?? ""}
          placeholder={template}
          className={`${field} leading-6`}
        />
      </label>

      <p className="text-xs leading-5 text-slate-500">
        Можно вставить готовый JD или написать его по подсказкам.
        Неизвестные условия отмечайте как «требует уточнения».
        Это внутренний документ, он не отправляется кандидатам.
      </p>

      {jd && (
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            name="approvalConfirmed"
            value="yes"
            className="mt-1"
            required
          />
          Я проверила текст. Для сохранения или утверждения подтверждаю,
          что внесённые изменения намеренные.
        </label>
      )}

      <div className="flex flex-wrap gap-3">
        <button type="submit" name="intent" value="save" className={button}>
          {jd ? "Сохранить изменения" : "Создать черновик"}
        </button>

        {jd && (
          <button
            type="submit"
            name="intent"
            value="approve"
            className="rounded-xl border border-indigo-300 px-5 py-3 text-sm font-medium text-indigo-700 hover:bg-indigo-50"
          >
            Сохранить и утвердить JD
          </button>
        )}
      </div>

      {jd && (
        <p className="text-xs text-slate-500">
          После утверждения редактирование этой версии будет закрыто.
        </p>
      )}
    </form>
  );
}

export default async function JDPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const { result } = await searchParams;
  let items: JD[] = [];
  let failed = false;

  try {
    const response = await fetch(API, {
      headers: {
        Authorization: (await headers()).get("authorization") ?? "",
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
        <a href="/" className="text-sm font-medium text-indigo-600">
          ← В кабинет
        </a>

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
                <JDForm />
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
                      <JDForm jd={jd} />
                    ) : (
                      <>
                        <p className="text-sm text-indigo-600">
                          {directions[jd.direction] ?? jd.direction}
                        </p>
                        <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">
                          {jd.content}
                        </p>
                        <p className="mt-6 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                          <a href={`/job-descriptions/${jd.id}/vacancy`} className="font-medium text-indigo-600">
                            Создать вакансию на основе JD →
                          </a>
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