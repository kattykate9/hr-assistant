from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated, Literal

from psycopg.types.json import Jsonb

from db import close_pool, connect_db, init_db, open_pool
from vacancy_archive import install_vacancy_archive
from candidate_workflow import ApplicationStatus, install_candidate_workflow
from company_settings import init_company_settings

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints


NonEmptyText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=500,
    ),
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    open_pool()
    with connect_db() as connection:
        init_db(connection)
        from auth_accounts import init_auth
        init_auth(connection)
        init_company_settings(connection)
    yield
    close_pool()


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
    vacancy_status: Literal["active", "archived"] = "active"
    archived_at: datetime | None = None
    archive_version: int = 1
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
    created_at = datetime.now(timezone.utc)

    with connect_db() as connection:
        vacancy_id = connection.execute(
            """
            INSERT INTO vacancies (
                title, direction, description, criteria, created_at
            )
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                vacancy.title,
                vacancy.direction,
                vacancy.description,
                Jsonb(vacancy.criteria),
                created_at,
            ),
        ).fetchone()["id"]

    return {
        **vacancy.model_dump(),
        "id": vacancy_id,
        "created_at": created_at,
    }


# Посмотреть вакансии
@app.get("/vacancies", response_model=list[Vacancy])
def list_vacancies(include_archived: bool = False):
    with connect_db() as connection:
        rows = connection.execute(
            "SELECT * FROM vacancies WHERE (%s OR vacancy_status='active') ORDER BY id DESC",
            (include_archived,)
        ).fetchall()

    return rows


# Создать отклик
@app.post("/applications", response_model=Application, status_code=201)
def create_application(application: ApplicationCreate):
    created_at = datetime.now(timezone.utc)

    with connect_db() as connection:
        # FOR SHARE: вакансию нельзя архивировать, пока отклик не сохранён.
        vacancy = connection.execute(
            "SELECT id, vacancy_status FROM vacancies WHERE id = %s FOR SHARE",
            (application.vacancy_id,),
        ).fetchone()

        if vacancy is None:
            raise HTTPException(
                status_code=404,
                detail="Вакансия не найдена",
            )

        if vacancy["vacancy_status"] != "active":
            raise HTTPException(status_code=409, detail="Вакансия закрыта. Выберите другую вакансию.")

        application_id = connection.execute(
            """
            INSERT INTO applications (
                vacancy_id, name, contact, source,
                resume_text, status, created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
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
        ).fetchone()["id"]

    return {
        **application.model_dump(),
        "id": application_id,
        "status": "new",
        "created_at": created_at,
    }


# Посмотреть все отклики или отклики на выбранную вакансию
@app.get("/applications", response_model=list[Application])
def list_applications(vacancy_id: int | None = None):
    with connect_db() as connection:
        if vacancy_id is None:
            rows = connection.execute(
                "SELECT * FROM applications ORDER BY id DESC"
            ).fetchall()
        else:
            rows = connection.execute(
                """
                SELECT * FROM applications
                WHERE vacancy_id = %s
                ORDER BY id DESC
                """,
                (vacancy_id,),
            ).fetchall()

    return rows

from job_descriptions import install_jd

install_jd(app, connect_db)


from vacancy_from_jd import install_vacancy_from_jd

install_vacancy_from_jd(app, connect_db)


from company_settings import install_company_settings

install_company_settings(app, connect_db)


from recruitment_views import install_recruitment_views

install_recruitment_views(app, connect_db)


install_candidate_workflow(app, connect_db)


install_vacancy_archive(app, connect_db)
