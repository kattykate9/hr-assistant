"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { API_URL, SESSION_COOKIE, apiFetch } from "@/lib/api";

export type LoginState = { error: string; username: string };
export async function login(_previous: LoginState, form: FormData): Promise<LoginState> {
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!username || username.length > 100 || !password || password.length > 256)
    return { error: "Введите логин и пароль.", username };
  const key = process.env.WEB_API_KEY ?? "";
  if (key.length < 32) return { error: "Вход ещё не настроен. Обратитесь к администратору.", username };
  let token: string;
  try {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Web-Key": key },
      body: JSON.stringify({ username, password }), cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return { error: response.status === 401 ? "Неверный логин или пароль."
      : response.status === 429 ? "Слишком много попыток. Повторите через 15 минут."
      : "Не удалось войти. Обратитесь к администратору.", username };
    const data = await response.json();
    if (typeof data.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(data.token)) throw new Error("Invalid session");
    token = data.token;
  } catch { return { error: "Нет связи с сервером. Попробуйте ещё раз позже.", username }; }
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 43200,
  });
  redirect("/");
}

export async function logout(): Promise<{ error: string }> {
  try {
    const response = await apiFetch(`${API_URL}/auth/logout`, { method: "POST", signal: AbortSignal.timeout(10000) });
    if (!response.ok && response.status !== 401) return { error: "Не удалось выйти. Повторите попытку." };
  } catch { return { error: "Сервер недоступен. Выход не подтверждён, попробуйте снова." }; }
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
