"""Private aggregate reports. No candidate texts are fetched or sent."""
import asyncio
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx
from aiogram import F, Router
from aiogram.filters import Command
from aiogram.types import LinkPreviewOptions
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter


def now_utc():
    return datetime.now(timezone.utc)


def valid_base_url(value):
    value = value.rstrip('/')
    p = urlsplit(value)
    if (not p.hostname or p.username or p.password or p.query or p.fragment
            or p.path or any(c.isspace() for c in value)):
        raise ValueError('WEB_BASE_URL должен содержать только адрес сайта без пароля и пути.')
    if p.scheme != 'https' and not (p.scheme == 'http' and p.hostname in ('127.0.0.1', 'localhost', '::1')):
        raise ValueError('Для публичного WEB_BASE_URL требуется HTTPS.')
    return value


class Ledger:
    def __init__(self, path):
        self.path = path
        with closing(self.connect()) as c, c:
            c.execute('CREATE TABLE IF NOT EXISTS report_delivery (recipient INTEGER, period TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(recipient, period))')

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

    def claim(self, recipient, period):
        # First installation establishes a baseline; no unsolicited old report.
        with closing(self.connect()) as c, c:
            c.execute('BEGIN IMMEDIATE')
            first = c.execute('SELECT 1 FROM report_delivery WHERE recipient=? LIMIT 1', (recipient,)).fetchone() is None
            status = 'baseline' if first else 'sending'
            cursor = c.execute('INSERT OR IGNORE INTO report_delivery VALUES (?, ?, ?, ?)', (recipient, period, status, now_utc().isoformat()))
            return cursor.rowcount == 1 and not first

    def finish(self, recipient, period, status):
        with closing(self.connect()) as c, c:
            c.execute('UPDATE report_delivery SET status=?, updated_at=? WHERE recipient=? AND period=?', (status, now_utc().isoformat(), recipient, period))

    def release(self, recipient, period):
        with closing(self.connect()) as c, c:
            c.execute("DELETE FROM report_delivery WHERE recipient=? AND period=? AND status='sending'", (recipient, period))

    def latest(self, recipient):
        with closing(self.connect()) as c:
            return c.execute('SELECT status, updated_at FROM report_delivery WHERE recipient=? ORDER BY updated_at DESC LIMIT 1', (recipient,)).fetchone()


def report_text(report, base):
    zone = ZoneInfo(report['timezone'])
    start = datetime.fromisoformat(report['period_start']).astimezone(zone)
    end = datetime.fromisoformat(report['period_end']).astimezone(zone)
    title = 'Утренний' if report['kind'] == 'morning' else 'Вечерний'
    lines = [f'{title} отчёт HR Assistant', f'{start:%d.%m.%Y %H:%M} — {end:%d.%m.%Y %H:%M}',
             f'Часовой пояс: {zone.key}', '', 'Без откликов hh.ru (до согласования условий).',
             f"Получено откликов: {report['received']}",
             f"Из них сейчас в статусе «новый»: {report['new_in_period']}",
             'AI-обработка и первичная AI-оценка не подключены.', '', 'Источники:']
    labels = {'telegram': 'Telegram', 'manual': 'Вручную', 'website': 'Сайт', 'linkedin': 'LinkedIn', 'djinni': 'Djinni'}
    other = 0
    for row in report['sources']:
        if row['source'] == 'hh':
            raise ValueError('Недопустимый источник в Telegram-отчёте')
        if row['source'] in labels:
            if row['count']:
                lines.append(f"• {labels[row['source']]}: {row['count']}")
        else:
            other += row['count']
    if other:
        lines.append(f'• Другие: {other}')
    if not report['received']:
        lines.append('За этот период новых откликов нет.')
    tasks = report.get('tasks')
    if tasks:
        as_of = datetime.fromisoformat(tasks['generated_at']).astimezone(ZoneInfo(tasks['timezone']))
        lines += ['', f"Действия на {as_of:%d.%m.%Y %H:%M} ({tasks['timezone']}), без hh.ru:",
                  f"Просроченные: {tasks['overdue_count']}", f"Сегодня, ещё предстоит: {tasks['today_count']}",
                  f"Всего открытых: {tasks['open_count']}",
                  'Задачи в защищённом кабинете (включая hh, если они есть):', base + '/#tasks']
    # Link comes from our aggregate endpoint, never from candidate input.
    path = report['applications_url']
    if not path.startswith('/applications?') or '\n' in path or '\r' in path:
        raise ValueError('Неверная ссылка отчёта')
    lines += ['', 'Все отклики за период в кабинете (включая hh, если они есть):', base + path]
    if urlsplit(base).hostname in ('127.0.0.1', 'localhost', '::1'):
        lines.append('Локальная ссылка: открывается только на Mac с запущенным приложением.')
    lines += ['', 'Это последний завершённый период. Текущий период доступен в кабинете.']
    return '\n'.join(lines)


class ReportService:
    def __init__(self, api_url, key, env, root):
        raw_id = env.get('TELEGRAM_REPORT_CHAT_ID', '').strip()
        if raw_id and (not raw_id.isdecimal() or int(raw_id) <= 0):
            raise ValueError('TELEGRAM_REPORT_CHAT_ID должен быть положительным числом из /myid.')
        self.recipient = int(raw_id) if raw_id else None
        self.base = valid_base_url(env.get('WEB_BASE_URL', 'http://127.0.0.1:3000'))
        self.api_url, self.key = api_url, key
        self.ledger = Ledger(Path(root) / 'telegram_reports.db') if self.recipient else None
        self.next_at = None
        self.last_error = None
        self.retry_at = 0.0
        self.manual_lock = asyncio.Lock()
        self.last_manual = 0.0
        self.router = Router(name='private_hr_reports')
        self.router.message.filter(F.chat.type == 'private')
        self.router.message.register(self.myid, Command('myid'))
        self.router.message.register(self.manual, Command('report'))
        self.router.message.register(self.status, Command('report_status'))

    def authorized(self, message):
        return bool(self.recipient and message.chat.type == 'private' and message.from_user
                    and message.from_user.id == self.recipient and message.chat.id == self.recipient)

    async def myid(self, message):
        await message.answer(f'Ваш Telegram ID: {message.chat.id}\nДля настройки отчётов добавьте его в TELEGRAM_REPORT_CHAT_ID в .env на своём компьютере. Сам по себе /myid не предоставляет доступ к отчётам.')

    async def fetch(self):
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            r = await client.get(self.api_url + '/recruiting/telegram-report', headers={'X-Bot-Key': self.key})
            r.raise_for_status()
            data = r.json()
        if data.get('scope') != 'without_hh' or data.get('mode') != 'latest':
            raise ValueError('Неожиданный формат отчёта')
        self.next_at = data['next_report_at']
        return data

    async def manual(self, message):
        if not self.authorized(message):
            await message.answer('Отчёт доступен только настроенному владельцу бота.')
            return
        async with self.manual_lock:
            loop = asyncio.get_running_loop()
            if loop.time() - self.last_manual < 5:
                await message.answer('Подождите несколько секунд перед повторным запросом.')
                return
            self.last_manual = loop.time()
            try:
                report = await self.fetch()
                text = report_text(report, self.base)
            except Exception as error:
                self.last_error = type(error).__name__
                await message.answer('Не удалось получить отчёт. Проверьте сервер Python и выполните /report_status.')
                return
            await message.answer(text, parse_mode=None, link_preview_options=LinkPreviewOptions(is_disabled=True))

    async def status(self, message):
        if not self.authorized(message):
            await message.answer('Статус отчётов доступен только владельцу бота.')
            return
        latest = self.ledger.latest(self.recipient)
        statuses = {'baseline': 'ожидание следующего периода', 'sent': 'отправлен',
                    'sending': 'доставка не подтверждена; автоматический повтор запрещён',
                    'unknown': 'доставка не подтверждена; получите отчёт через /report',
                    'blocked': 'Telegram отклонил отправку; проверьте доступ бота к чату'}
        parts = ['Бот запущен. Автоотчёты включены.', 'Расписание берётся из настроек компании в кабинете.',
                 'Отклики hh.ru исключены.']
        if self.next_at:
            parts.append('Следующая граница периода: ' + self.next_at)
        if latest:
            parts.append('Последняя запись: ' + statuses.get(latest[0], latest[0]))
        if self.last_error:
            parts.append('Последняя ошибка: ' + self.last_error + '. Проверьте сервер и соединение.')
        parts.append('Ручной отчёт: /report. Команда не отменяет отправку по расписанию.')
        await message.answer('\n'.join(parts))

    async def tick(self, bot):
        if asyncio.get_running_loop().time() < self.retry_at:
            return
        report = await self.fetch()
        text = report_text(report, self.base)
        period = report['period_start'] + '/' + report['period_end']
        if not self.ledger.claim(self.recipient, period):
            self.last_error = None
            return
        try:
            await bot.send_message(self.recipient, text, parse_mode=None, link_preview_options=LinkPreviewOptions(is_disabled=True))
        except TelegramRetryAfter as error:
            # Explicit rejection: Telegram says to retry later; no message accepted.
            self.ledger.release(self.recipient, period)
            self.retry_at = asyncio.get_running_loop().time() + error.retry_after + 1
            self.last_error = type(error).__name__
        except (TelegramBadRequest, TelegramForbiddenError) as error:
            self.ledger.finish(self.recipient, period, 'blocked')
            self.last_error = type(error).__name__
        except Exception as error:
            # Network failure may occur AFTER Telegram accepted a message.
            self.ledger.finish(self.recipient, period, 'unknown')
            self.last_error = type(error).__name__
        else:
            self.ledger.finish(self.recipient, period, 'sent')
            self.last_error = None

    async def run(self, bot):
        if not self.recipient:
            print('Отчёты выключены: отправьте боту /myid, добавьте TELEGRAM_REPORT_CHAT_ID в .env и перезапустите бот.')
            return
        print('Автоотчёты включены. Настройки времени — в кабинете; проверка каждые 30 секунд. /report_status — статус.')
        while True:
            try:
                await self.tick(bot)
            except Exception as error:
                # Never log request URLs, credentials, response bodies or resumes.
                self.last_error = type(error).__name__
                print('Отчёт временно недоступен: ' + self.last_error)
            await asyncio.sleep(30)
