import LoginForm from "./login-form";
export const dynamic = "force-dynamic";
export default function LoginPage() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-12 font-sans">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mb-8 flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 font-bold text-white">HR</span><span className="text-xl font-semibold text-slate-900">HR Assistant</span></div>
      <h1 className="text-2xl font-semibold text-slate-900">Вход в рабочее пространство</h1>
      <p className="mt-3 text-sm leading-6 text-slate-500">Вакансии, отклики и работа с кандидатами — в одном кабинете.</p>
      <LoginForm />
    </section>
  </main>;
}
