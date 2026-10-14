"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginForm() {
  const [state, action, pending] = useActionState(login, { error: "", username: "" });
  return <form action={action} className="mt-8 space-y-5">
    <div><label htmlFor="username" className="mb-2 block text-sm font-medium text-slate-700">Логин</label>
      <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
        required maxLength={100} defaultValue={state.username} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></div>
    <div><label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700">Пароль</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={256}
        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" /></div>
    {state.error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}
    <button disabled={pending} className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white hover:bg-indigo-700 disabled:opacity-60">{pending ? "Входим…" : "Войти"}</button>
    <p className="text-center text-xs leading-5 text-slate-500">Доступ выдаёт администратор вашей команды.<br />Если забыли пароль, обратитесь к нему для сброса.</p>
  </form>;
}
