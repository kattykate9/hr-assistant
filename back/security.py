import os
import secrets
from pathlib import Path

from dotenv import dotenv_values
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


config = dotenv_values(
    Path(__file__).resolve().parent / ".env",
    interpolate=False,
)


# Переменные окружения (docker swarm) имеют приоритет над файлом .env.
def setting(name):
    return (os.environ.get(name) or config.get(name) or "").strip()


BOT_KEY = setting("BOT_API_KEY")

if not BOT_KEY:
    raise RuntimeError("Не настроен BOT_API_KEY в .env")

BOT_ROUTES = {
    ("GET", "/vacancies"),
    ("GET", "/recruiting/telegram-report"),
    ("POST", "/applications"),
}


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
