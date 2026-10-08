import { headers } from "next/headers";
import SettingsForm, { type Settings, type SaveResult } from "./settings-form";

export const dynamic = "force-dynamic";

async function saveSettings(previous: SaveResult, form: FormData): Promise<SaveResult> {
  "use server";
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const payload = {
    company_name: text("company_name"),
    company_description: text("company_description"),
    website: text("website"),
    hr_email: text("hr_email"),
    vacancy_language: text("vacancy_language"),
    report_timezone: text("report_timezone"),
    morning_report_time: text("morning_report_time"),
    evening_report_time: text("evening_report_time"),
    version: Number(form.get("version")),
  };
  const version = previous.version ?? payload.version;
  if (!Number.isSafeInteger(payload.version) || payload.version < 1) {
    return { error: "Не удалось определить версию настроек. Обновите страницу.", version };
  }
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/settings/company`, {
      method: "PUT",
      headers: { Authorization: (await headers()).get("authorization") ?? "", "Content-Type": "application/json" },
      body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 422) {
        const errors: string[] = Array.isArray(data?.detail)
          ? data.detail.map((item: { msg?: string }) => String(item.msg ?? "Некорректное поле").replace(/^Value error, /, ""))
          : [];
        return { error: errors.join(". ") || "Проверьте заполнение полей.", version };
      }
      const messages: Record<number, string> = {
        401: "Нужно снова войти в кабинет.", 403: "Нет доступа к настройкам.",
        409: "Настройки изменены в другой вкладке. Скопируйте свои правки, затем обновите страницу.",
        429: "Слишком много попыток. Повторите через минуту.",
      };
      return { error: messages[response.status] ?? "Не удалось сохранить настройки.", version };
    }
    return { error: "", version: data.version, saved: data as Settings };
  } catch {
    return { error: "Сервер не подтвердил сохранение. Поля остались в форме. Скопируйте правки и обновите страницу, чтобы проверить результат.", version };
  }
}

export default async function SettingsPage() {
  let settings: Settings | null = null;
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/settings/company`, {
      headers: { Authorization: (await headers()).get("authorization") ?? "" },
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (response.ok) settings = await response.json();
  } catch { settings = null; }
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 font-sans text-slate-900">
      <div className="mx-auto max-w-4xl space-y-6">
        <a href="/" className="text-sm text-indigo-600">← В рабочее пространство</a>
        <div><h1 className="text-3xl font-semibold">Настройки компании</h1>
          <p className="mt-3 text-sm leading-6 text-slate-500">Профиль компании и параметры будущих отчётов.</p></div>
        {settings ? <SettingsForm initial={settings} action={saveSettings} /> : (
          <div role="alert" className="rounded-xl bg-amber-50 p-5 text-sm text-amber-900">
            Не удалось загрузить настройки. Проверьте, что Python-сервер запущен и вы вошли в кабинет.
            <a href="/settings" className="ml-2 underline">Повторить загрузку</a>
          </div>
        )}
      </div>
    </main>
  );
}
