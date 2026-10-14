import { NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/login") return NextResponse.next();
  const token = request.cookies.get("hr_session")?.value;
  const toLogin = () => {
    const response = NextResponse.redirect(new URL("/login", request.url), 303);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return toLogin();
  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/auth/check`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (response.status === 401 || response.status === 403) return toLogin();
    if (!response.ok) throw new Error("Unavailable");
  } catch {
    return new NextResponse("Сервис временно недоступен. Попробуйте обновить страницу позже.", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "30" },
    });
  }
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
