"""HR Assistant bot: local PDF/DOCX/DOC resume extraction.
Dependencies: pypdf, defusedxml; legacy DOC uses macOS /usr/bin/textutil.
No external AI calls. Original documents are temporary and not archived.
"""
import asyncio
import io
import json
import logging
import os
import re
import signal
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

MAX_RESUME_BYTES = 10 * 1024 * 1024
MAX_RESUME_CHARS = 50000
MAX_PDF_PAGES = 30
EXTRACT_TIMEOUT = 25


class ResumeError(Exception):
    pass


def clean_resume(text):
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    text = ''.join(c for c in text if c in '\n\t' or (ord(c) >= 32 and ord(c) != 127))
    text = re.sub(r'\n[ \t]*\n(?:[ \t]*\n)+', '\n\n', text).strip()
    if not text or not any(c.isalnum() for c in text):
        raise ResumeError('Не найден читаемый текст. Если это скан или фото, пришлите документ с выделяемым текстом либо резюме сообщением.')
    if len(text) > MAX_RESUME_CHARS:
        raise ResumeError('В резюме более 50 000 символов. Пришлите сокращённый документ: текст не обрезается автоматически.')
    return text


def extract_resume_local(path, extension):
    path = Path(path)
    if not 0 < path.stat().st_size <= MAX_RESUME_BYTES:
        raise ResumeError('Файл пустой или больше 10 МБ. Пришлите другой файл.')
    with path.open('rb') as f:
        header = f.read(8)
    if extension == '.pdf':
        if not header.startswith(b'%PDF-'):
            raise ResumeError('Содержимое файла не соответствует PDF. Экспортируйте резюме в PDF заново.')
        from pypdf import PdfReader
        reader = PdfReader(str(path))
        if reader.is_encrypted:
            raise ResumeError('PDF защищён. Пришлите копию без пароля или резюме текстом.')
        if len(reader.pages) > MAX_PDF_PAGES:
            raise ResumeError('Для резюме принимаются PDF до 30 страниц. Пришлите сокращённый файл.')
        parts, empty_pages, size = [], [], 0
        for number, page in enumerate(reader.pages, 1):
            text = page.extract_text() or ''
            size += len(text)
            if size > MAX_RESUME_CHARS:
                raise ResumeError('В PDF слишком много текста. Пришлите сокращённое резюме до 50 000 символов.')
            if not text.strip():
                empty_pages.append(number)
            parts.append(text)
        result = clean_resume('\n\n'.join(parts))
        if empty_pages:
            result = clean_resume('[Примечание: на страницах ' + ', '.join(map(str, empty_pages)) + ' текст не извлечён; изображения не распознаются.]\n\n' + result)
        return result
    if extension == '.docx':
        if not header.startswith(b'PK'):
            raise ResumeError('DOCX повреждён, защищён паролем или имеет другой формат. Пришлите незашифрованный DOCX или PDF.')
        from defusedxml.ElementTree import fromstring
        ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
        with zipfile.ZipFile(path) as archive:
            items = archive.infolist()
            if len(items) > 2000 or sum(i.file_size for i in items) > 30 * 1024 * 1024:
                raise ResumeError('Документ слишком сложный для обработки. Экспортируйте его в PDF с текстом.')
            if any(i.flag_bits & 1 for i in items):
                raise ResumeError('Пришлите документ без пароля.')
            names = archive.namelist()
            if 'word/document.xml' not in names or any('vbaproject' in n.lower() for n in names):
                raise ResumeError('Нужен обычный DOCX без макросов. Пришлите DOCX или PDF.')
            parts = []
            # Preserve paragraph/table order, then include headers, footers and notes.
            selected = ['word/document.xml'] + sorted(n for n in names if re.fullmatch(r'word/(?:header\d+|footer\d+|footnotes|endnotes)\.xml', n))
            size = 0
            for name in selected:
                node = fromstring(archive.read(name), forbid_dtd=True, forbid_entities=True, forbid_external=True)
                for element in node.iter():
                    if element.tag == ns + 't':
                        text = element.text or ''
                        size += len(text)
                        if size > MAX_RESUME_CHARS:
                            raise ResumeError('В DOCX более 50 000 символов. Пришлите сокращённое резюме.')
                        parts.append(text)
                    elif element.tag in (ns + 'br', ns + 'cr'):
                        parts.append('\n')
                    elif element.tag == ns + 'tab':
                        parts.append('\t')
                    elif element.tag == ns + 'p':
                        parts.append('\n')
            return clean_resume(''.join(parts))
    if extension == '.doc':
        if header != b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1':
            raise ResumeError('Это не обычный Word DOC. Откройте его в Word и сохраните как DOCX или PDF.')
        converter = Path('/usr/bin/textutil')
        if sys.platform != 'darwin' or not converter.is_file():
            raise ResumeError('Чтение старого DOC на этом сервере недоступно. Пришлите DOCX, PDF или текст.')
        target = path.parent / 'converted.txt'
        completed = subprocess.run(
            [str(converter), '-convert', 'txt', '-encoding', 'UTF-8', '-output', str(target), str(path)],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=15, check=False,
        )
        if completed.returncode != 0 or not target.is_file():
            raise ResumeError('Не удалось прочитать DOC: возможно, он повреждён или защищён. Пришлите DOCX или PDF без пароля.')
        if target.stat().st_size > MAX_RESUME_CHARS * 4:
            raise ResumeError('В DOC слишком много текста. Пришлите сокращённое резюме.')
        return clean_resume(target.read_text(encoding='utf-8-sig'))
    raise ResumeError('Поддерживаются только PDF, DOCX и DOC.')


def extraction_worker():
    # Runs in a disposable process. Never load .env or bot credentials here.
    logging.disable(logging.CRITICAL)
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (15, 15))
        resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024, 16 * 1024 * 1024))
        if sys.platform == 'linux':
            resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
        text = extract_resume_local(sys.argv[2], sys.argv[3])
        result = {'text': text}
    except ResumeError as error:
        result = {'error': str(error)}
    except ImportError:
        result = {'error': 'Модуль чтения файлов не настроен. Сообщите HR и пока отправьте резюме текстом.'}
    except Exception:
        result = {'error': 'Не удалось прочитать файл. Пришлите другой PDF/DOCX/DOC без пароля или резюме текстом.'}
    print(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__' and len(sys.argv) == 4 and sys.argv[1] == '--extract-resume':
    extraction_worker()
    raise SystemExit(0)


class LimitedDownload(io.BytesIO):
    def write(self, data):
        if self.tell() + len(data) > MAX_RESUME_BYTES:
            raise ResumeError('Файл больше 10 МБ. Пришлите файл меньшего размера.')
        return super().write(data)


async def parse_downloaded_resume(path, extension):
    process = await asyncio.create_subprocess_exec(
        sys.executable, '-I', str(Path(__file__).resolve()), '--extract-resume', str(path), extension,
        stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        start_new_session=True,
        env={'PATH': os.defpath, 'LANG': 'en_US.UTF-8'},
    )
    try:
        output, _ = await asyncio.wait_for(process.communicate(), timeout=EXTRACT_TIMEOUT)
    except BaseException as error:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await process.wait()
        if isinstance(error, asyncio.TimeoutError):
            raise ResumeError('Файл обрабатывается слишком долго. Пришлите упрощённый DOCX/PDF или текст.') from None
        raise
    if process.returncode != 0:
        raise ResumeError('Не удалось обработать файл в допустимых пределах. Пришлите другой документ или текст.')
    try:
        result = json.loads(output)
    except (ValueError, UnicodeError):
        raise ResumeError('Не удалось прочитать файл. Пришлите другой документ или текст.') from None
    if 'error' in result:
        raise ResumeError(result['error'])
    return clean_resume(result['text'])


resume_slots = asyncio.Semaphore(2)


async def get_document_text(message):
    document = message.document
    extension = Path(document.file_name or '').suffix.lower()
    if extension not in ('.pdf', '.docx', '.doc'):
        raise ResumeError('Пришлите резюме файлом PDF, DOCX или DOC, либо обычным текстом. Фото и другие форматы пока не поддерживаются.')
    if document.file_size is not None and document.file_size > MAX_RESUME_BYTES:
        raise ResumeError('Файл больше 10 МБ. Пришлите файл меньшего размера.')
    try:
        await asyncio.wait_for(resume_slots.acquire(), timeout=1)
    except asyncio.TimeoutError:
        raise ResumeError('Сейчас обрабатываются другие резюме. Повторите отправку через минуту.') from None
    try:
        await message.answer('Получил файл. Извлекаю текст резюме…')
        with LimitedDownload() as buffer:
            try:
                await asyncio.wait_for(message.bot.download(document, destination=buffer, timeout=30), timeout=35)
            except ResumeError:
                raise
            except Exception:
                raise ResumeError('Не удалось скачать файл из Telegram. Попробуйте отправить его ещё раз.') from None
            with tempfile.TemporaryDirectory(prefix='hr-resume-') as temporary:
                # Never use an uploaded filename as a filesystem path.
                path = Path(temporary) / ('resume' + extension)
                path.write_bytes(buffer.getvalue())
                return await parse_downloaded_resume(path, extension)
    finally:
        resume_slots.release()


import asyncio
from contextlib import suppress
from bot_reports import ReportService
import os
from pathlib import Path

import httpx
from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import (
    MemoryStorage,
    SimpleEventIsolation,
)
from aiogram.types import Message
from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parent / ".env")

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
API_URL = os.getenv(
    "API_BASE_URL", "http://127.0.0.1:8000"
).rstrip("/")

BOT_API_KEY = os.getenv("BOT_API_KEY", "").strip()
if not BOT_API_KEY:
    raise SystemExit("BOT_API_KEY не найден в .env")

router = Router()
router.message.filter(F.chat.type == "private")


class Form(StatesGroup):
    vacancy = State()
    name = State()
    contact = State()
    resume = State()


async def get_text(message: Message, max_length: int):
    text = (message.text or "").strip()

    if not text or text.startswith("/"):
        await message.answer(
            "Отправьте ответ обычным текстом. "
            "Для отмены используйте /cancel."
        )
        return None

    if len(text) > max_length:
        await message.answer(
            f"Сократите ответ до {max_length} символов."
        )
        return None

    return text


@router.message(CommandStart())
async def start(message: Message, state: FSMContext):
    await state.clear()

    try:
        async with httpx.AsyncClient(timeout=15, headers={"X-Bot-Key": BOT_API_KEY}) as client:
            response = await client.get(f"{API_URL}/vacancies")
            response.raise_for_status()
            vacancies = sorted(
                [vacancy for vacancy in response.json() if vacancy.get("vacancy_status", "active") == "active"],
                key=lambda vacancy: int(vacancy["id"]),
            )
    except (httpx.HTTPError, ValueError):
        await message.answer(
            "Не удалось загрузить вакансии. "
            "Попробуйте /start позже."
        )
        return

    if not vacancies:
        await message.answer("Пока нет доступных вакансий.")
        return

    await state.update_data(
        vacancies={
            str(number): {"id": vacancy["id"], "title": vacancy["title"]}
            for number, vacancy in enumerate(vacancies, start=1)
        }
    )
    await state.set_state(Form.vacancy)

    await message.answer(
        "Здравствуйте! Это тестовый бот для откликов. "
        "Пока используйте только вымышленные данные.\n\n"
        "Выберите вакансию: отправьте её номер.\n"
        "Отмена заполнения — /cancel."
    )

    # Отправляем частями, чтобы не превысить лимит Telegram.
    chunk = ""
    for number, vacancy in enumerate(vacancies, start=1):
        line = f'{number}. {vacancy["title"]}\n'
        if len(chunk) + len(line) > 3500:
            await message.answer(chunk)
            chunk = ""
        chunk += line

    if chunk:
        await message.answer(chunk)


@router.message(Command("cancel"))
async def cancel(message: Message, state: FSMContext):
    await state.clear()
    await message.answer(
        "Заполнение отменено. Начать заново — /start."
    )


@router.message(Form.vacancy)
async def choose_vacancy(message: Message, state: FSMContext):
    choice = (message.text or "").strip()
    data = await state.get_data()
    vacancies = data.get("vacancies", {})

    if choice not in vacancies:
        await message.answer("Введите номер вакансии из списка.")
        return

    selected = vacancies[choice]
    await state.update_data(vacancy_id=int(selected["id"]))
    await state.set_state(Form.name)
    await message.answer(
        f"Вакансия: {selected['title']}\n\nКак вас зовут?"
    )


@router.message(Form.name)
async def receive_name(message: Message, state: FSMContext):
    text = await get_text(message, 500)
    if text is None:
        return

    await state.update_data(name=text)
    await state.set_state(Form.contact)
    await message.answer(
        "Укажите контакт для связи: email или Telegram @username."
    )


@router.message(Form.contact)
async def receive_contact(message: Message, state: FSMContext):
    text = await get_text(message, 500)
    if text is None:
        return

    await state.update_data(contact=text)
    await state.set_state(Form.resume)
    await message.answer(
        "Отправьте резюме одним текстовым сообщением до 4000 символов "
        "или прикрепите один файл PDF, DOCX или DOC до 10 МБ.\n\n"
        "PDF — до 30 страниц с выделяемым текстом, без пароля. "
        "Сканы и фото пока не распознаются. Из документа сохраняется текст "
        "до 50 000 символов; исходный файл в кабинете не хранится."
    )


@router.message(Form.resume)
async def receive_resume(message: Message, state: FSMContext):
    if message.chat.type != 'private' or not message.from_user or message.chat.id != message.from_user.id:
        await message.answer('Для отправки отклика откройте личный чат с ботом и отправьте /start.')
        return
    if message.document:
        try:
            text = await get_document_text(message)
        except ResumeError as error:
            await message.answer(str(error))
            return
    else:
        if not message.text:
            await message.answer("Пришлите PDF, DOCX, DOC или текст резюме. Фото, голосовые сообщения и ссылки вместо файла пока не поддерживаются.")
            return
        text = await get_text(message, 4000)
        if text is None:
            return

    data = await state.get_data()
    if not all(key in data for key in ("vacancy_id", "name", "contact")):
        await state.clear()
        await message.answer("Анкета устарела. Начните заново через /start.")
        return
    payload = {
        "vacancy_id": data["vacancy_id"],
        "name": data["name"],
        "contact": data["contact"],
        "source": "telegram",
        "telegram_chat_id": message.chat.id,
        "resume_text": text,
    }

    try:
        async with httpx.AsyncClient(timeout=20, headers={"X-Bot-Key": BOT_API_KEY}) as client:
            response = await client.post(
                f"{API_URL}/applications",
                json=payload,
            )
    except httpx.RequestError:
        # Запрос мог сохраниться, даже если ответ не дошёл.
        # Автоматически повторять его нельзя: возможен дубль.
        await state.clear()
        await message.answer(
            "Не удалось подтвердить сохранение отклика. "
            "Попросите HR проверить его наличие перед повторной отправкой."
        )
        return

    if response.status_code == 409:
        await state.clear()
        await message.answer(
            "Эта вакансия закрылась во время заполнения анкеты. "
            "Отклик не сохранён. Выберите другую вакансию через /start."
        )
        return

    if response.status_code == 404:
        await state.clear()
        await message.answer(
            "Вакансия больше недоступна. Выберите другую через /start."
        )
        return

    if response.status_code != 201:
        await state.clear()
        await message.answer(
            "Сервер не подтвердил приём отклика. "
            "Обратитесь к HR для проверки."
        )
        return

    await state.clear()
    await message.answer(
        "Спасибо! Текст резюме сохранён, отклик ожидает рассмотрения. "
        "AI-оценка пока не подключена."
    )


@router.message()
async def fallback(message: Message):
    await message.answer(
        "Чтобы выбрать вакансию и оставить отклик, отправьте /start."
    )


async def main():
    if not TOKEN:
        print("Добавьте TELEGRAM_BOT_TOKEN в файл .env.")
        return

    dispatcher = Dispatcher(
        storage=MemoryStorage(),
        events_isolation=SimpleEventIsolation(),
    )
    reports = ReportService(API_URL, BOT_API_KEY, os.environ, Path(__file__).resolve().parent)
    dispatcher.include_router(reports.router)
    dispatcher.include_router(router)

    async with Bot(token=TOKEN) as bot:
        info = await bot.get_me()
        print(f"Бот @{info.username} запущен. Остановка: Ctrl+C.")
        task = asyncio.create_task(reports.run(bot))
        try:
            await dispatcher.start_polling(bot, close_bot_session=False)
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
    except Exception as error:
        # Не выводим полный текст ошибки, который может содержать токен.
        print(
            f"Бот остановлен: {type(error).__name__}. "
            "Проверьте токен, интернет и отсутствие второго запуска бота."
        )
