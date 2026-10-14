import { apiFetch } from "@/lib/api";
import VacancyForm, { type DraftResult, type CompanyProfile } from "./vacancy-form";

export const dynamic = "force-dynamic";

type JD = {
  id: number;
  title: string;
  direction: string;
  content: string;
  status: string;
  version: number;
};

type SaveResult = {
  error: string;
  id?: number;
  created?: boolean;
};

const directions: Record<string, string> = {
  traffic: "Арбитраж трафика",
  development: "Программирование",
  roblox: "Roblox",
};

async function saveVacancy(
  jdId: number,
  jdVersion: number,
  previous: SaveResult,
  form: FormData,
): Promise<SaveResult> {
  "use server";

  const lines = (name: string) =>
    String(form.get(name) ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

  if (form.get("reviewed") !== "yes") {
    return { error: "Подтвердите проверку публичного текста." };
  }

  const payload = {
    title: String(form.get("title") ?? "").trim(),
    description: String(form.get("description") ?? "").trim(),
    criteria: lines("criteria"),
    preferred_criteria: lines("preferred_criteria"),
    jd_version: jdVersion,
    language: String(form.get("language") ?? ""),
  };

  if (!["ru", "en", "uk"].includes(payload.language)) {
    return { error: "Выберите язык вакансии." };
  }

  if (
    payload.title.length < 1 ||
    payload.title.length > 200 ||
    payload.description.length < 20 ||
    payload.description.length > 20000
  ) {
    return { error: "Проверьте название и длину описания." };
  }

  if (
    payload.criteria.length < 1 ||
    payload.criteria.length > 30 ||
    payload.preferred_criteria.length > 30 ||
    [...payload.criteria, ...payload.preferred_criteria].some(
      (item) => item.length > 500,
    )
  ) {
    return {
      error:
        "Укажите 1–30 обязательных и до 30 желательных критериев. Каждый — до 500 символов.",
    };
  }

  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/job-descriptions/${jdId}/vacancy`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
      },
    );

    if (!response.ok) {
      const messages: Record<number, string> = {
        401: "Нужно снова войти в кабинет.",
        403: "Нет доступа к созданию вакансии.",
        404: "JD не найден.",
        409: "JD не утверждён или его версия изменилась. Обновите страницу.",
        422: "Сервер отклонил поля. Проверьте заполнение формы.",
        429: "Слишком много попыток. Повторите через минуту.",
      };

      return {
        error: messages[response.status] ?? "Не удалось сохранить вакансию.",
      };
    }

    const data = await response.json();
    return { error: "", id: data.id, created: data.created };
  } catch {
    return {
      error:
        "Нет подтверждения от сервера. Можно повторить отправку: для этой версии JD вторая вакансия не создастся.",
    };
  }
}

async function prepareVacancy(
  jdId: number,
  jdVersion: number,
  shareWithOpenAI: boolean,
  language: string,
): Promise<DraftResult> {
  "use server";
  if (!shareWithOpenAI) return { error: "Подтвердите передачу JD и профиля компании в OpenAI." };
  if (!["ru", "en", "uk"].includes(language)) return { error: "Выберите язык вакансии." };
  try {
    const response = await apiFetch(
      `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/job-descriptions/${jdId}/vacancy-draft`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jd_version: jdVersion, share_with_openai: true, language }),
        cache: "no-store",
        signal: AbortSignal.timeout(90000),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        error: typeof data?.detail === "string"
          ? data.detail
          : "Не удалось подготовить текст. Проверьте вход в кабинет и доступность сервера.",
      };
    }
    if (!data || typeof data.title !== "string" || typeof data.description !== "string" ||
        !Array.isArray(data.criteria) || !Array.isArray(data.preferred_criteria) || !Array.isArray(data.questions)) {
      return { error: "Сервер вернул некорректный черновик. Поля не изменены." };
    }
    return { error: "", draft: data };
  } catch {
    return { error: "Не удалось получить ответ сервера. Поля сохранены в форме. Повторный запрос к ИИ может оплачиваться отдельно." };
  }
}

export default async function CreateVacancyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  let jd: JD | null = null;
  let company: CompanyProfile | null = null;
  try {
    const response = await apiFetch(`${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/settings/company`, {
      
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      const data = await response.json();
      company = {
        company_name: data.company_name, company_description: data.company_description,
        website: data.website, hr_email: data.hr_email, vacancy_language: data.vacancy_language,
      };
    }
  } catch { company = null; }

  if (/^[1-9]\d*$/.test(id)) {
    try {
      const response = await apiFetch(
        `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/job-descriptions/${id}`,
        {
          headers: {
          },
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        },
      );

      if (response.ok) jd = await response.json();
    } catch {
      jd = null;
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 font-sans text-slate-900">
      <div className="mx-auto max-w-4xl space-y-6">
        <a href="/job-descriptions" className="text-sm text-indigo-600">
          ← К Job Description
        </a>

        <h1 className="text-3xl font-semibold">Создать вакансию</h1>

        {!jd ? (
          <p role="alert" className="rounded-xl bg-amber-50 p-5">
            JD не найден или сервер недоступен.
          </p>
        ) : jd.status !== "approved" ? (
          <p role="alert" className="rounded-xl bg-amber-50 p-5">
            Сначала утвердите Job Description.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              Основа: JD №{jd.id}, версия {jd.version} ·{" "}
              {directions[jd.direction] ?? jd.direction}
            </p>

            <details className="rounded-2xl border border-slate-200 bg-white p-5">
              <summary className="cursor-pointer font-medium">
                Посмотреть внутренний JD
              </summary>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">
                {jd.content}
              </p>
            </details>

            <VacancyForm
              title={jd.title}
              company={company}
              prepare={prepareVacancy.bind(null, jd.id, jd.version)}
              action={saveVacancy.bind(null, jd.id, jd.version)}
            />
          </>
        )}
      </div>
    </main>
  );
}
