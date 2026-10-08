import asyncio
import base64
import binascii
import os
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


# Переменные окружения (docker swarm) имеют приоритет над файлом .env.
def setting(name):
    return (os.environ.get(name) or config.get(name) or "").strip()


USERNAME = setting("ADMIN_USERNAME")
PASSWORD_HASH = setting("ADMIN_PASSWORD_HASH")
BOT_KEY = setting("BOT_API_KEY")

if not all((USERNAME, PASSWORD_HASH, BOT_KEY)):
    raise RuntimeError("Не настроены учётные данные в .env")

hasher = PasswordHasher()

# Ограничитель для одного локального процесса.
failures = deque()
login_lock = asyncio.Lock()

BOT_ROUTES = {
    ("GET", "/vacancies"),
    ("GET", "/recruiting/telegram-report"),
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
