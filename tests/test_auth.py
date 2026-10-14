"""Auth boundary tests using an in-memory DB double (no production connections)."""
import os
import sys
import unittest
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'back'))
os.environ['BOT_API_KEY'] = 'test-bot-key'
os.environ['WEB_API_KEY'] = 'test-web-key-' + 'x' * 32
from fastapi import FastAPI
from fastapi.testclient import TestClient
import auth_accounts as auth
import security

class Result:
    def __init__(self, row=None): self.row = row
    def fetchone(self): return self.row

class FakeDB:
    def __init__(self):
        self.user = {'username': 'kate', 'password_hash': auth.password_hash('a-test-password'), 'active': True}
        self.sessions = {}
        self.limits = {}
    def execute(self, sql, args=()):
        q = ' '.join(sql.split())
        if q.startswith('SELECT pg_advisory'): return Result()
        if q.startswith('DELETE FROM hr_auth_limits'): return Result()
        if q.startswith('SELECT * FROM hr_auth_limits'): return Result(self.limits.get(args[0]))
        if q.startswith('INSERT INTO hr_auth_limits'):
            self.limits[args[0]] = {'started_at': args[1], 'attempts': 1}; return Result()
        if q.startswith('UPDATE hr_auth_limits'):
            self.limits[args[0]]['attempts'] += 1; return Result()
        if q.startswith('SELECT * FROM hr_auth_users'):
            return Result(self.user if args[0] == 'kate' else None)
        if q.startswith('INSERT INTO hr_auth_sessions'):
            self.sessions[args[0]] = (args[1], args[2]); return Result()
        if q.startswith('DELETE FROM hr_auth_sessions WHERE expires_at'):
            self.sessions = {k:v for k,v in self.sessions.items() if v[1] > datetime.now(timezone.utc)}; return Result()
        if q.startswith('DELETE FROM hr_auth_sessions WHERE token_hash'):
            self.sessions.pop(args[0], None); return Result()
        if q.startswith('SELECT u.username'):
            row = self.sessions.get(args[0])
            return Result({'username': row[0]} if row and self.user['active'] and row[1] > datetime.now(timezone.utc) else None)
        raise AssertionError(q)
    @contextmanager
    def connection(self): yield self

class AuthTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB()
        self.patcher = patch.object(auth, 'connect_db', self.db.connection); self.patcher.start()
        app = FastAPI()
        security.install_security(app)
        @app.get('/health')
        def health(): return {'ok': True}
        @app.get('/vacancies')
        def vacancies(): return []
        @app.get('/private')
        def private(): return {'private': True}
        @app.post('/private')
        def write(): return {'saved': True}
        self.client = TestClient(app)
    def tearDown(self): self.patcher.stop()
    def login(self, username='kate', password='a-test-password'):
        return self.client.post('/auth/login', headers={'X-Web-Key': os.environ['WEB_API_KEY']}, json={'username': username, 'password': password})
    def test_anonymous_and_cookie_cannot_access_api(self):
        for path in ['/private', '/vacancies', '/docs', '/openapi.json', '/auth/check']:
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(self.client.post('/private').status_code, 401)
        self.assertEqual(self.client.get('/health').status_code, 200)
        token = self.login().json()['token']
        self.assertEqual(self.client.get('/private', headers={'Cookie': f'hr_session={token}'}).status_code, 401)
    def test_login_requires_web_key_and_generic_errors(self):
        self.assertEqual(self.client.post('/auth/login', json={'username': 'kate', 'password': 'wrong'}).status_code, 403)
        self.assertEqual(self.login(password='wrong').json(), self.login(username='missing').json())
        self.assertEqual(self.login(password='wrong').status_code, 401)
    def test_session_roundtrip_revocation_and_bot_permissions(self):
        response = self.login()
        self.assertEqual(response.status_code, 200)
        token = response.json()['token']; headers = {'Authorization': f'Bearer {token}'}
        self.assertNotIn(token, self.db.sessions)
        self.assertIn(auth.token_hash(token), self.db.sessions)
        self.assertEqual(self.client.get('/private', headers=headers).status_code, 200)
        self.assertEqual(self.client.post('/private', headers=headers).status_code, 200)
        self.assertEqual(self.client.post('/auth/logout', headers=headers).status_code, 204)
        self.assertEqual(self.client.get('/private', headers=headers).status_code, 401)
        bot = {'X-Bot-Key': os.environ['BOT_API_KEY']}
        self.assertEqual(self.client.get('/vacancies', headers=bot).status_code, 200)
        self.assertEqual(self.client.get('/private', headers=bot).status_code, 403)
        self.assertEqual(self.client.get('/vacancies', headers={'X-Bot-Key': 'wrong'}).status_code, 403)
    def test_expiry_disabled_and_cache(self):
        token = self.login().json()['token']; headers = {'Authorization': f'Bearer {token}'}
        self.db.user['active'] = False
        self.assertEqual(self.client.get('/auth/check', headers=headers).status_code, 401)
        self.db.user['active'] = True
        self.db.sessions[auth.token_hash(token)] = ('kate', datetime.now(timezone.utc) - timedelta(seconds=1))
        r = self.client.get('/auth/check', headers=headers)
        self.assertEqual(r.status_code, 401); self.assertEqual(r.headers['cache-control'], 'no-store')
    def test_rate_limits(self):
        for _ in range(10): self.assertEqual(self.login(password='wrong').status_code, 401)
        self.assertEqual(self.login().status_code, 429)
        self.db.limits['user:' + auth.token_hash('kate')]['started_at'] -= timedelta(minutes=16)
        self.assertEqual(self.login().status_code, 200)
    def test_passwords(self):
        one = auth.password_hash('password'); two = auth.password_hash('password')
        self.assertNotEqual(one, two)
        self.assertTrue(auth.verify_password('password', one))
        self.assertFalse(auth.verify_password('bad', one))
        self.assertFalse(auth.verify_password('password', 'bad'))

if __name__ == '__main__': unittest.main()
