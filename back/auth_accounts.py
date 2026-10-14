"""Internal staff accounts and revocable sessions; no public registration."""
import hashlib
import hmac
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from db import connect_db

SESSION_SECONDS = 12 * 60 * 60
ITERATIONS = 600_000
SCHEMA = """
CREATE TABLE IF NOT EXISTS hr_auth_users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS hr_auth_sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL REFERENCES hr_auth_users(username) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS hr_auth_session_expiry ON hr_auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS hr_auth_limits (
    bucket TEXT PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL
);
"""

def init_auth(connection):
    connection.execute("SELECT pg_advisory_xact_lock(4826114)")
    connection.execute(SCHEMA)


def normalize_username(value):
    return value.strip().lower()


def password_hash(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), ITERATIONS).hex()
    return f'pbkdf2_sha256${ITERATIONS}${salt}${digest}'


def verify_password(password, stored):
    try:
        algorithm, rounds, salt, expected = stored.split('$')
        if algorithm != 'pbkdf2_sha256' or int(rounds) != ITERATIONS:
            return False
        digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), int(rounds)).hex()
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False

DUMMY_HASH = password_hash('not-an-account-' + secrets.token_hex(16))


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def bearer(request):
    value = request.headers.get('authorization', '')
    if not value.startswith('Bearer '):
        return ''
    token = value[7:]
    return token if re.fullmatch(r'[A-Za-z0-9_-]{43}', token) else ''


def session_user(request):
    token = bearer(request)
    if not token:
        return None
    with connect_db() as connection:
        row = connection.execute("""
            SELECT u.username FROM hr_auth_sessions s
            JOIN hr_auth_users u ON u.username = s.username
            WHERE s.token_hash=%s AND s.expires_at > now() AND u.active
        """, (token_hash(token),)).fetchone()
    return row['username'] if row else None


def rate_allowed(username):
    now = datetime.now(timezone.utc)
    allowed = True
    with connect_db() as connection:
        # Serializes counters across all API workers/replicas.
        connection.execute('SELECT pg_advisory_xact_lock(4826115)')
        connection.execute("DELETE FROM hr_auth_limits WHERE started_at < %s", (now - timedelta(days=1),))
        for bucket, seconds, limit in [('global', 60, 60), ('user:' + token_hash(username), 900, 10)]:
            row = connection.execute('SELECT * FROM hr_auth_limits WHERE bucket=%s', (bucket,)).fetchone()
            if not row or row['started_at'] <= now - timedelta(seconds=seconds):
                connection.execute('''INSERT INTO hr_auth_limits (bucket,started_at,attempts) VALUES (%s,%s,1)
                    ON CONFLICT(bucket) DO UPDATE SET started_at=excluded.started_at,attempts=1''', (bucket, now))
            elif row['attempts'] >= limit:
                allowed = False
            else:
                connection.execute('UPDATE hr_auth_limits SET attempts=attempts+1 WHERE bucket=%s', (bucket,))
    return allowed


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=1, max_length=256)


def install_auth_routes(app):
    @app.post('/auth/login')
    def login(payload: Login):
        username = normalize_username(payload.username)
        if not rate_allowed(username):
            return JSONResponse({'detail': 'Слишком много попыток. Повторите через 15 минут.'}, status_code=429)
        # SHARE lock prevents a simultaneous password reset from leaving a new old-password session.
        with connect_db() as connection:
            user = connection.execute('SELECT * FROM hr_auth_users WHERE username=%s FOR SHARE', (username,)).fetchone()
            valid = verify_password(payload.password, user['password_hash'] if user else DUMMY_HASH)
            if not valid or not user or not user['active']:
                raise HTTPException(401, 'Неверный логин или пароль')
            token = secrets.token_urlsafe(32)
            connection.execute('DELETE FROM hr_auth_sessions WHERE expires_at <= now()')
            connection.execute('INSERT INTO hr_auth_sessions (token_hash,username,expires_at) VALUES (%s,%s,%s)',
                               (token_hash(token), username, datetime.now(timezone.utc) + timedelta(seconds=SESSION_SECONDS)))
        return {'token': token, 'max_age': SESSION_SECONDS, 'username': username}

    @app.get('/auth/check')
    def check(request: Request):
        return {'username': request.state.username}

    @app.post('/auth/logout')
    def logout(request: Request):
        with connect_db() as connection:
            connection.execute('DELETE FROM hr_auth_sessions WHERE token_hash=%s', (token_hash(bearer(request)),))
        return Response(status_code=204)
