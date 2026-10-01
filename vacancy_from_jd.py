import json
from contextlib import closing
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints


Criterion = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=500),
]


class VacancyFromJD(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    language: Literal["ru", "en", "uk"] = "ru"
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=20, max_length=20000)
    criteria: list[Criterion] = Field(min_length=1, max_length=30)
    preferred_criteria: list[Criterion] = Field(
        default_factory=list,
        max_length=30,
    )
    jd_version: int = Field(ge=1)


class DraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    jd_version: int = Field(ge=1)
    share_with_openai: Literal[True]
    language: Literal["ru", "en", "uk"] = "ru"


def install_vacancy_from_jd(app, connect_db):
    router = APIRouter(tags=["Вакансия из JD"])

    with closing(connect_db()) as connection:
        with connection:
            columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(vacancies)")
            }

            additions = {
                "language": "TEXT",
                "source_jd_id": "INTEGER REFERENCES job_descriptions(id)",
                "source_jd_version": "INTEGER",
                "preferred_criteria": "TEXT NOT NULL DEFAULT '[]'",
            }

            for name, definition in additions.items():
                if name not in columns:
                    connection.execute(
                        f"ALTER TABLE vacancies ADD COLUMN {name} {definition}"
                    )

            connection.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS vacancy_jd_version
                ON vacancies(source_jd_id, source_jd_version)
                WHERE source_jd_id IS NOT NULL
            """)

    @router.get("/job-descriptions/{jd_id}")
    def get_jd(jd_id: int):
        with closing(connect_db()) as connection:
            row = connection.execute(
                "SELECT * FROM job_descriptions WHERE id = ?",
                (jd_id,),
            ).fetchone()

        if row is None:
            raise HTTPException(404, "JD не найден")

        return dict(row)

    @router.post("/job-descriptions/{jd_id}/vacancy")
    def create_from_jd(jd_id: int, data: VacancyFromJD):
        with closing(connect_db()) as connection:
            with connection:
                # Одновременные запросы не создадут две вакансии.
                connection.execute("BEGIN IMMEDIATE")

                jd = connection.execute(
                    "SELECT * FROM job_descriptions WHERE id = ?",
                    (jd_id,),
                ).fetchone()

                if jd is None:
                    raise HTTPException(404, "JD не найден")

                if jd["status"] != "approved":
                    raise HTTPException(409, "Сначала утвердите JD")

                if jd["version"] != data.jd_version:
                    raise HTTPException(
                        409,
                        "Версия JD изменилась. Обновите страницу.",
                    )

                existing = connection.execute(
                    """
                    SELECT id FROM vacancies
                    WHERE source_jd_id = ? AND source_jd_version = ?
                    """,
                    (jd_id, data.jd_version),
                ).fetchone()

                if existing:
                    return {
                        "id": existing["id"],
                        "created": False,
                    }

                now = datetime.now(timezone.utc).isoformat()
                cursor = connection.execute(
                    """
                    INSERT INTO vacancies (
                        title, direction, description, criteria,
                        created_at, source_jd_id, source_jd_version,
                        preferred_criteria, language
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        data.title,
                        jd["direction"],
                        data.description,
                        json.dumps(data.criteria, ensure_ascii=False),
                        now,
                        jd_id,
                        data.jd_version,
                        json.dumps(
                            data.preferred_criteria,
                            ensure_ascii=False,
                        ),
                        data.language,
                    ),
                )

                return {
                    "id": cursor.lastrowid,
                    "created": True,
                }

    @router.post("/job-descriptions/{jd_id}/vacancy-draft")
    def prepare_draft(jd_id: int, data: DraftRequest):
        from ai_vacancy import generate_vacancy_draft

        with closing(connect_db()) as connection:
            jd = connection.execute(
                "SELECT * FROM job_descriptions WHERE id = ?", (jd_id,)
            ).fetchone()
        if jd is None:
            raise HTTPException(404, "JD не найден")
        if jd["status"] != "approved" or jd["version"] != data.jd_version:
            raise HTTPException(409, "JD не утверждён или его версия изменилась. Обновите страницу.")
        with closing(connect_db()) as connection:
            existing = connection.execute(
                "SELECT id FROM vacancies WHERE source_jd_id = ? AND source_jd_version = ?",
                (jd_id, data.jd_version),
            ).fetchone()
        if existing:
            raise HTTPException(409, f"Для этой версии JD уже создана вакансия №{existing['id']}. Чтобы проверить ИИ, создайте и утвердите новый JD.")
        # Existing application-wide security middleware also protects this route.
        # No database write or vacancy creation occurs during generation.
        with closing(connect_db()) as connection:
            row = connection.execute("SELECT data FROM company_settings WHERE id = 1").fetchone()
        company = json.loads(row["data"]) if row else {}
        public_company = {key: company.get(key, "") for key in (
            "company_name", "company_description", "website", "hr_email"
        )}
        draft = generate_vacancy_draft(dict(jd), language=data.language, company=public_company)
        with closing(connect_db()) as connection:
            current = connection.execute(
                "SELECT status, version FROM job_descriptions WHERE id = ?", (jd_id,)
            ).fetchone()
        if current is None or current["status"] != "approved" or current["version"] != data.jd_version:
            raise HTTPException(409, "JD изменился во время подготовки. Обновите страницу.")
        return draft

    app.include_router(router)
