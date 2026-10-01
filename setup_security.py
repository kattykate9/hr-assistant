from datetime import datetime
from pathlib import Path
import shutil

from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parent
ENV = dotenv_values(ROOT / ".env", interpolate=False)

required = [
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD_HASH",
    "BOT_API_KEY",
]

missing = [name for name in required if not ENV.get(name)]
if missing:
    raise SystemExit(
        "Сначала выполните настройку пароля из предыдущего шага. "
        "Не найдены: " + ", ".join(missing)
    )

main_path = ROOT / "main.py"
bot_path = ROOT / "bot.py"
page_path = ROOT / "web/src/app/page.tsx"
proxy_path = ROOT / "web/src/proxy.ts"
security_path = ROOT / "security.py"

for path in (main_path, bot_path, page_path):
    if not path.is_file():
        raise SystemExit(f"Не найден файл: {path.name}")

if security_path.exists() or proxy_path.exists():
    raise SystemExit(
        "Файлы защиты уже существуют. Повторную установку не выполняем."
    )

main_text = main_path.read_text()
bot_text = bot_path.read_text()
page_text = page_path.read_text()


def replace_once(text, old, new, filename):
    if text.count(old) != 1:
        raise SystemExit(
            f"Структура {filename} отличается от ожидаемой. "
            "Ничего не изменено. Пришлите это сообщение."
        )
    return text.replace(old, new, 1)


main_text = replace_once(
    main_text,
    "# Модели вакансий",
    "from security import install_security\n\n"
    "install_security(app)\n\n\n"
    "# Модели вакансий",
    "main.py",
)

bot_text = replace_once(
    bot_text,
    "router = Router()",
    'BOT_API_KEY = os.getenv("BOT_API_KEY", "").strip()\n'
    'if not BOT_API_KEY:\n'
    '    raise SystemExit("BOT_API_KEY не найден в .env")\n\n'
    "router = Router()",
    "bot.py",
)

for timeout in (15, 20):
    bot_text = replace_once(
        bot_text,
        f"httpx.AsyncClient(timeout={timeout})",
        f'httpx.AsyncClient(timeout={timeout}, '
        'headers={"X-Bot-Key": BOT_API_KEY})',
        "bot.py",
    )

page_text = replace_once(
    page_text,
    'export const dynamic = "force-dynamic";',
    'import { headers } from "next/headers";\n\n'
    'export const dynamic = "force-dynamic";',
    "page.tsx",
)

page_text = replace_once(
    page_text,
    '      cache: "no-store",',
    '      cache: "no-store",\n'
    '      headers: {\n'
    '        Authorization: '
    '(await headers()).get("authorization") ?? "",\n'
    '      },',
    "page.tsx",
)

page_text = page_text.replace(
    "Локальная версия для проверки. Авторизация ещё не подключена.",
    "Локальная версия. Доступ по учётной записи администратора.",
)

security_code = r'''
import asyncio
import base64
import binascii
import secrets
import time
from collections import deque
from pathlib import Path

from argon2 import PasswordHasher
from argon2.exceptions import (
    InvalidHashError,
    VerificationError,
)
from dotenv import dotenv_values
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse


config = dotenv_values(
    Path(__file__).resolve().parent / ".env",
    interpolate=False,
)

USERNAME = config.get("ADMIN_USERNAME", "")
PASSWORD_HASH = config.get("ADMIN_PASSWORD_HASH", "")
BOT_KEY = config.get("BOT_API_KEY", "")

if not all((USERNAME, PASSWORD_HASH, BOT_KEY)):
    raise RuntimeError("Не настроены учётные данные в .env")

hasher = PasswordHasher()

# Ограничитель для одного локального процесса.
failures = deque()
login_lock = asyncio.Lock()

BOT_ROUTES = {
    ("GET", "/vacancies"),
    ("POST", "/applications"),
}


def password_matches(username, password):
    try:
        valid = hasher.verify(PASSWORD_HASH, password)
    except (VerificationError, InvalidHashError):
        return False

    return valid and secrets.compare_digest(
        username.encode("utf-8"),
        USERNAME.encode("utf-8"),
    )


def unauthorized():
    return JSONResponse(
        status_code=401,
        content={"detail": "Требуется вход"},
        headers={
            "WWW-Authenticate": 'Basic realm="HR Assistant", charset="UTF-8"',
            "Cache-Control": "no-store",
        },
    )


def install_security(app: FastAPI):
    @app.middleware("http")
    async def protect_api(request: Request, call_next):
        path = request.url.path.rstrip("/") or "/"
        route = (request.method, path)

        if route == ("GET", "/health"):
            return await call_next(request)

        supplied_key = request.headers.get("X-Bot-Key")
        if supplied_key is not None:
            key_matches = secrets.compare_digest(
                supplied_key.encode("utf-8"),
                BOT_KEY.encode("utf-8"),
            )
            if not key_matches or route not in BOT_ROUTES:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Доступ бота запрещён"},
                )

            response = await call_next(request)
            response.headers["Cache-Control"] = "no-store"
            return response

        authorization = request.headers.get("Authorization", "")
        scheme, _, encoded = authorization.partition(" ")

        if scheme.lower() != "basic" or len(encoded) > 4096:
            return unauthorized()

        try:
            decoded = base64.b64decode(
                encoded, validate=True
            ).decode("utf-8")
            username, separator, password = decoded.partition(":")
            if not separator:
                return unauthorized()
        except (ValueError, UnicodeError, binascii.Error):
            return unauthorized()

        async with login_lock:
            now = time.monotonic()
            while failures and now - failures[0] >= 60:
                failures.popleft()

            if len(failures) >= 10:
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Повторите вход через минуту"},
                    headers={
                        "Retry-After": "60",
                        "Cache-Control": "no-store",
                    },
                )

            valid = await asyncio.to_thread(
                password_matches, username, password
            )
            if not valid:
                failures.append(time.monotonic())
                return unauthorized()

        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/auth/check", include_in_schema=False)
    def check_auth():
        return Response(status_code=204)
'''.lstrip()

proxy_code = r'''
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
    const response = await fetch("http://127.0.0.1:8000/auth/check", {
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
'''.lstrip()

# Все проверки выше выполняются до изменения файлов.
stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

for path in (main_path, bot_path, page_path):
    backup = path.with_name(f"{path.name}.{stamp}.backup")
    shutil.copy2(path, backup)

security_path.write_text(security_code)
proxy_path.write_text(proxy_code)
main_path.write_text(main_text)
bot_path.write_text(bot_text)
page_path.write_text(page_text)

print("Готово. Защита подключена.")
print("Резервные копии сохранены рядом с исходными файлами.")
print("Теперь перезапустите Python-сервер, Telegram-бота и Next.js.")