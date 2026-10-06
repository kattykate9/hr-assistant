# Образ для API (FastAPI) и Telegram-бота: один образ, разные команды.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY *.py ./

# Код хранит SQLite-базы рядом с собой (/app/*.db).
# Переносим их в том /app/data через симлинки, не меняя код.
RUN useradd --system --uid 10001 app \
    && mkdir -p /app/data \
    && ln -s /app/data/hr_assistant.db /app/hr_assistant.db \
    && ln -s /app/data/telegram_reports.db /app/telegram_reports.db \
    && chown -R app:app /app/data

USER app

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
