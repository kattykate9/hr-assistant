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
                response.json(),
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
            str(vacancy["id"]): vacancy["title"]
            for vacancy in vacancies
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
    for vacancy in vacancies:
        line = f'{vacancy["id"]}. {vacancy["title"]}\n'
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

    await state.update_data(vacancy_id=int(choice))
    await state.set_state(Form.name)
    await message.answer(
        f"Вакансия: {vacancies[choice]}\n\nКак вас зовут?"
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
        "Отправьте краткое резюме одним текстовым сообщением "
        "до 4000 символов: опыт, навыки и проекты.\n\n"
        "Загрузка PDF и DOCX пока не подключена."
    )


@router.message(Form.resume)
async def receive_resume(message: Message, state: FSMContext):
    text = await get_text(message, 4000)
    if text is None:
        return

    data = await state.get_data()
    payload = {
        "vacancy_id": data["vacancy_id"],
        "name": data["name"],
        "contact": data["contact"],
        "source": "telegram",
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
        "Спасибо! Отклик сохранён и ожидает рассмотрения. "
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
