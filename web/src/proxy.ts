import { NextRequest, NextResponse } from "next/server";

function requestLogin() {
  return new NextResponse("Войдите в кабинет HR Assistant.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="HR Assistant", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export async function proxy(request: NextRequest) {
  const authorization = request.headers.get("authorization");

  if (!authorization || authorization.length > 4102) {
    return requestLogin();
  }

  try {
    const response = await fetch(`${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8000"}/auth/check`, {
      headers: { Authorization: authorization },
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });

    if (response.status === 401) {
      return requestLogin();
    }

    if (response.status === 429) {
      return new NextResponse(
        "Слишком много попыток входа. Повторите через минуту.",
        {
          status: 429,
          headers: {
            "Retry-After": "60",
            "Cache-Control": "no-store",
          },
        },
      );
    }

    if (response.status !== 204) {
      return new NextResponse("Не удалось проверить доступ.", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const result = NextResponse.next();
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  } catch {
    return new NextResponse(
      "Сервер недоступен. Запустите Python-сервер на порту 8000.",
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
