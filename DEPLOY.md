# HR Assistant — деплой

## Состав

| Сервис | Что это | Порт | Команда |
|---|---|---|---|
| `api` | FastAPI + SQLite (`main.py`) | 8000 (только внутри) | `uvicorn main:app --workers 1` |
| `web` | Next.js 16 кабинет HR (`web/`) | 3000 | `next start` |
| `bot` | Telegram-бот на aiogram 3, long polling (`bot.py`) | — | `python bot.py` |

```
Интернет ──HTTPS──> reverse proxy ──> web:3000 ──http://127.0.0.1:8000──> api:8000 ──> SQLite (/app/data)
Telegram <──polling── bot ──http://api:8000 (X-Bot-Key)──> api
api ──HTTPS──> api.openai.com (генерация черновиков вакансий)
```

`api` и `bot` собираются из одного образа (`Dockerfile` в корне), `web` — из `web/Dockerfile`.

## Требования

- Linux-хост с Docker 24+ и Docker Compose v2.
- Исходящий доступ к `api.telegram.org` и `api.openai.com`.
- Домен и TLS-сертификат для кабинета (обязательно HTTPS, см. ниже).
- Ресурсы: хватит 1 vCPU / 1 GB RAM / несколько GB диска.

## Важные особенности кода (учесть при деплое)

1. **Web ходит в API строго на `http://127.0.0.1:8000`** — адрес зашит в `web/src/**`. Поэтому в compose контейнер `web` запущен с `network_mode: "service:api"` (общий сетевой namespace), а порт 3000 публикуется на сервисе `api`. Если разносить на разные хосты/поды — web и api должны быть в одном поде (k8s sidecar) или код нужно поправить на переменную окружения.
2. **API читает секреты только из файла `/app/.env`**, а не из переменных окружения (`security.py`, `ai_vacancy.py`). Файл `.env` монтируется в контейнер read-only. Без него API не стартует (`Не настроены учётные данные в .env`).
3. **Только один воркер uvicorn и одна реплика API**: SQLite + ограничитель попыток входа хранится в памяти процесса.
4. **Только один экземпляр бота** на токен (long polling). Второй запуск, включая локальный у разработчика, будет конфликтовать (`TelegramConflictError`).
5. **`WEB_BASE_URL` для не-localhost обязан быть `https://`** — иначе бот падает при старте.
6. **Базы SQLite** (`hr_assistant.db`, `telegram_reports.db`) лежат в томе `hr-data` (`/app/data`). Это единственное состояние — его и бэкапим.
7. **Резюме в формате `.doc`** читаются только на macOS (`textutil`). На Linux бот вежливо попросит прислать PDF/DOCX — это ожидаемо. PDF и DOCX работают.
8. Авторизация кабинета — HTTP Basic (логин `ADMIN_USERNAME`, пароль по хешу argon2). Поэтому кабинет **только за HTTPS**.

## Переменные окружения (`.env`)

Шаблон — `.env.example`. Реальные значения передаются отдельно, в git не коммитятся.

| Переменная | Обяз. | Кто использует | Описание |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | да | bot | Токен от @BotFather |
| `BOT_API_KEY` | да | api, bot | Общий секрет бот↔API (заголовок `X-Bot-Key`) |
| `ADMIN_USERNAME` | да | api | Логин в кабинет |
| `ADMIN_PASSWORD_HASH` | да | api | argon2id-хеш пароля, в **одинарных кавычках** (в хеше есть `$`) |
| `WEB_BASE_URL` | да | bot | Публичный адрес кабинета, `https://hr.example.com` (без пути и `/` в конце) |
| `TELEGRAM_REPORT_CHAT_ID` | нет | bot | Chat id получателя утренних/вечерних отчётов (бот отвечает на `/myid`). Пусто — отчёты выключены |
| `OPENAI_API_KEY` | нет | api | Для генерации вакансии из JD. Без него остальное работает |
| `OPENAI_MODEL` | нет | api | По умолчанию `gpt-4.1-mini` |
| `API_BASE_URL` | — | bot | В compose переопределяется на `http://api:8000`, задавать не нужно |
| `SESSION_SECRET`, `WEB_API_KEY` | — | — | Сейчас в коде не используются |

Сгенерировать новые секреты / хеш пароля (после сборки образа):

```bash
# случайный ключ (для BOT_API_KEY и т.п.)
docker compose run --rm --no-deps api python -c "import secrets; print(secrets.token_urlsafe(48))"

# хеш пароля администратора
docker compose run --rm --no-deps api python -c "from argon2 import PasswordHasher; print(PasswordHasher().hash(input('password: ')))"
```

## Первый деплой

```bash
git clone <gitlab-url>/hr-assistant.git /opt/hr-assistant
cd /opt/hr-assistant

cp .env.example .env
vi .env                      # заполнить значения, WEB_BASE_URL=https://<домен>
chmod 644 .env               # контейнер работает от uid 10001, файл должен быть читаем
                             # (либо: chown 10001 .env && chmod 400 .env)

docker compose up -d --build
docker compose ps            # api должен стать healthy
docker compose logs -f bot   # ждём «Бот @... запущен»
```

Проверка:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/            # 401 — просит логин
curl -s -o /dev/null -w "%{http_code}\n" -u admin:<пароль> http://127.0.0.1:3000/   # 200
docker compose exec api python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/health').read())"
```

При первом старте API сам создаёт схему БД (миграции идемпотентные, запускаются при каждом старте).

## Reverse proxy (nginx)

Compose публикует web только на `127.0.0.1:3000`. Наружу — через nginx/traefik с TLS:

```nginx
server {
    listen 443 ssl http2;
    server_name hr.example.com;

    ssl_certificate     /etc/letsencrypt/live/hr.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hr.example.com/privkey.pem;

    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Authorization $http_authorization;  # Basic auth прокидывается в API
        proxy_read_timeout 90s;  # генерация вакансии через OpenAI идёт до 60 с
    }
}

server {
    listen 80;
    server_name hr.example.com;
    return 301 https://$host$request_uri;
}
```

Порт 8000 наружу не открывать.

## Обновление

```bash
cd /opt/hr-assistant
git pull
docker compose up -d --build
```

Данные в томе `hr-data` сохраняются. Перед обновлением — бэкап (ниже).

## Бэкап и восстановление

Бэкап консистентным снимком SQLite (без остановки сервиса):

```bash
mkdir -p /opt/backups
docker compose exec api python -c "
import sqlite3
for n in ('hr_assistant', 'telegram_reports'):
    try:
        src = sqlite3.connect(f'file:/app/data/{n}.db?mode=ro', uri=True)
    except sqlite3.OperationalError:
        continue
    src.backup(sqlite3.connect(f'/app/data/{n}.backup.db'))
"
docker compose cp api:/app/data/hr_assistant.backup.db /opt/backups/hr_assistant-$(date +%F).db
docker compose cp api:/app/data/telegram_reports.backup.db /opt/backups/telegram_reports-$(date +%F).db 2>/dev/null || true
```

Рекомендуется по cron раз в сутки + хранить вне сервера. Базы содержат персональные данные кандидатов.

Восстановление:

```bash
docker compose stop api bot
docker compose cp /opt/backups/hr_assistant-YYYY-MM-DD.db api:/app/data/hr_assistant.db
docker compose start api bot
```

## Логи и мониторинг

- `docker compose logs -f api|web|bot`
- Healthcheck: `GET /health` на api (встроен в compose).
- Бот при падении печатает только тип ошибки (без токена) и перезапускается (`restart: unless-stopped`).

## CI (GitLab), опционально

Минимальная сборка образов в GitLab Container Registry:

```yaml
build:
  image: docker:27
  services: [docker:27-dind]
  script:
    - docker login -u "$CI_REGISTRY_USER" -p "$CI_REGISTRY_PASSWORD" "$CI_REGISTRY"
    - docker build -t "$CI_REGISTRY_IMAGE/api:$CI_COMMIT_SHORT_SHA" .
    - docker build -t "$CI_REGISTRY_IMAGE/web:$CI_COMMIT_SHORT_SHA" web
    - docker push "$CI_REGISTRY_IMAGE/api:$CI_COMMIT_SHORT_SHA"
    - docker push "$CI_REGISTRY_IMAGE/web:$CI_COMMIT_SHORT_SHA"
```

Секреты (`.env`) хранить в GitLab CI/CD Variables (тип File, Masked/Protected) или в vault, но не в репозитории.

## Файлы, не нужные в проде

- `setup_security.py` — одноразовый скрипт, которым защита уже установлена. Не запускать.
- `page.tsx` в корне — старая копия, в сборку не входит.
