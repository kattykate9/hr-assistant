import os
import secrets
from pathlib import Path
from dotenv import dotenv_values
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from auth_accounts import install_auth_routes, session_user

config = dotenv_values(Path(__file__).resolve().parent / '.env', interpolate=False)

def setting(name):
    return (os.environ.get(name) or config.get(name) or '').strip()

BOT_KEY = setting('BOT_API_KEY')
WEB_KEY = setting('WEB_API_KEY')
if not BOT_KEY or len(WEB_KEY) < 32:
    raise RuntimeError('Нужны BOT_API_KEY и WEB_API_KEY (минимум 32 символа)')

BOT_ROUTES = {('GET', '/vacancies'), ('GET', '/recruiting/telegram-report'), ('POST', '/applications')}

def same_key(supplied, expected):
    return bool(supplied) and secrets.compare_digest(supplied.encode(), expected.encode())


def install_security(app: FastAPI):
    install_auth_routes(app)

    @app.middleware('http')
    async def protect_api(request: Request, call_next):
        route = (request.method, request.url.path.rstrip('/') or '/')
        error = None
        if route == ('GET', '/health'):
            pass
        elif request.headers.get('X-Bot-Key') is not None:
            if route not in BOT_ROUTES or not same_key(request.headers.get('X-Bot-Key'), BOT_KEY):
                error = JSONResponse({'detail': 'Доступ бота запрещён'}, status_code=403)
        elif route == ('POST', '/auth/login'):
            if not same_key(request.headers.get('X-Web-Key'), WEB_KEY):
                error = JSONResponse({'detail': 'Доступ запрещён'}, status_code=403)
        else:
            username = await run_in_threadpool(session_user, request)
            if not username:
                error = JSONResponse({'detail': 'Требуется вход'}, status_code=401)
            else:
                request.state.username = username
        response = error if error is not None else await call_next(request)
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response
