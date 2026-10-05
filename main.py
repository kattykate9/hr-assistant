import json
import sqlite3
from contextlib import asynccontextmanager, closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from candidate_workflow import ApplicationStatus, init_candidate_workflow, install_candidate_workflow

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints


DB_PATH = Path(__file__).resolve().parent / "hr_assistant.db"

NonEmptyText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=500,
    ),
]


# Подключение к базе данных
def connect_db():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


# Создание таблиц при первом запуске
def init_db():
    with closing(connect_db()) as connection:
        with connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS vacancies (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    description TEXT NOT NULL,
                    criteria TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
            """)

            connection.execute("""
                CREATE TABLE IF NOT EXISTS applications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    vacancy_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    contact TEXT NOT NULL,
                    source TEXT NOT NULL,
                    resume_text TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'new',
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (vacancy_id) REFERENCES vacancies(id)
                )
            """)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    init_candidate_workflow(connect_db)
    yield


app = FastAPI(
    title="HR Assistant",
    lifespan=lifespan,
)


from security import install_security

install_security(app)


# Модели вакансий
class VacancyCreate(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    title: NonEmptyText
    direction: Literal["traffic", "development", "roblox"]
    description: str = Field(min_length=1, max_length=20000)
    criteria: list[NonEmptyText] = Field(min_length=1, max_length=30)


class Vacancy(VacancyCreate):
    language: Literal["ru", "en", "uk"] | None = None
    source_jd_id: int | None = None
    source_jd_version: int | None = None
    preferred_criteria: list[str] = Field(default_factory=list)
    id: int
    created_at: datetime


# Модели откликов
class ApplicationCreate(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    vacancy_id: int = Field(gt=0)
    name: NonEmptyText
    contact: NonEmptyText
    source: Literal[
        "telegram",
        "hh",
        "linkedin",
        "djinni",
        "website",
        "manual",
    ]
    resume_text: str = Field(min_length=1, max_length=50000)


class Application(ApplicationCreate):
    id: int
    status: ApplicationStatus
    review_version: int = 1
    created_at: datetime


def vacancy_from_row(row):
    result = dict(row)
    result["criteria"] = json.loads(result["criteria"])
    result["preferred_criteria"] = json.loads(
        result.get("preferred_criteria", "[]")
    )
    return result


# Проверка работы сервера
@app.get("/health")
def health():
    return {
        "status": "ok",
        "app": "HR Assistant",
    }


# Создать вакансию
@app.post("/vacancies", response_model=Vacancy, status_code=201)
def create_vacancy(vacancy: VacancyCreate):
    created_at = datetime.now(timezone.utc).isoformat()

    with closing(connect_db()) as connection:
        with connection:
            cursor = connection.execute(
                """
                INSERT INTO vacancies (
                    title, direction, description, criteria, created_at
                )
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    vacancy.title,
                    vacancy.direction,
                    vacancy.description,
                    json.dumps(vacancy.criteria, ensure_ascii=False),
                    created_at,
                ),
            )
            vacancy_id = cursor.lastrowid

    return {
        **vacancy.model_dump(),
        "id": vacancy_id,
        "created_at": created_at,
    }


# Посмотреть вакансии
@app.get("/vacancies", response_model=list[Vacancy])
def list_vacancies():
    with closing(connect_db()) as connection:
        rows = connection.execute(
            "SELECT * FROM vacancies ORDER BY id DESC"
        ).fetchall()

    return [vacancy_from_row(row) for row in rows]


# Создать отклик
@app.post("/applications", response_model=Application, status_code=201)
def create_application(application: ApplicationCreate):
    created_at = datetime.now(timezone.utc).isoformat()

    with closing(connect_db()) as connection:
        vacancy = connection.execute(
            "SELECT id FROM vacancies WHERE id = ?",
            (application.vacancy_id,),
        ).fetchone()

        if vacancy is None:
            raise HTTPException(
                status_code=404,
                detail="Вакансия не найдена",
            )

        with connection:
            cursor = connection.execute(
                """
                INSERT INTO applications (
                    vacancy_id, name, contact, source,
                    resume_text, status, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    application.vacancy_id,
                    application.name,
                    application.contact,
                    application.source,
                    application.resume_text,
                    "new",
                    created_at,
                ),
            )
            application_id = cursor.lastrowid

    return {
        **application.model_dump(),
        "id": application_id,
        "status": "new",
        "created_at": created_at,
    }


# Посмотреть все отклики или отклики на выбранную вакансию
@app.get("/applications", response_model=list[Application])
def list_applications(vacancy_id: int | None = None):
    with closing(connect_db()) as connection:
        if vacancy_id is None:
            rows = connection.execute(
                "SELECT * FROM applications ORDER BY id DESC"
            ).fetchall()
        else:
            rows = connection.execute(
                """
                SELECT * FROM applications
                WHERE vacancy_id = ?
                ORDER BY id DESC
                """,
                (vacancy_id,),
            ).fetchall()

    return [dict(row) for row in rows]

from job_descriptions import install_jd

install_jd(app, connect_db)


from vacancy_from_jd import install_vacancy_from_jd

install_vacancy_from_jd(app, connect_db)


from company_settings import install_company_settings

install_company_settings(app, connect_db)


from recruitment_views import install_recruitment_views

install_recruitment_views(app, connect_db)


install_candidate_workflow(app, connect_db)
