"use client";
import { useActionState } from "react";
import { logout } from "./login/actions";
export default function LogoutButton() {
  const [state, action, pending] = useActionState(logout, { error: "" });
  return <form action={action} className="flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 bg-white px-6 py-2 text-sm text-slate-600">
    {state.error && <span role="alert" className="text-red-700">{state.error}</span>}
    <button disabled={pending} className="rounded-lg border border-slate-200 px-3 py-1 hover:bg-slate-50 disabled:opacity-50">{pending ? "Выходим…" : "Выйти"}</button>
  </form>;
}
