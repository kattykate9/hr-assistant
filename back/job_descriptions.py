from ai_jd import JDInputs, generate_jd_draft
from psycopg.types.json import Jsonb
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field


class JDCreate(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    title: str = Field(min_length=1, max_length=200)
    direction: Literal["traffic", "development", "roblox"]
    content: str = Field(min_length=20, max_length=30000)
    internal_notes: str | None = Field(default=None, max_length=10000)
    template_inputs: JDInputs | None = None


class JDUpdate(JDCreate):
    version: int = Field(ge=1)
    approve: bool = False


class JDDraftRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=200)
    direction: Literal["traffic", "development", "roblox"]
    inputs: JDInputs
    share_with_openai: bool = False


def install_jd(app, connect_db):
    router = APIRouter(prefix="/job-descriptions", tags=["Job Description"])

    @router.post("/ai-draft")
    def prepare_jd(data: JDDraftRequest):
        return generate_jd_draft(data)

    @router.get("")
    def list_jds():
        with connect_db() as connection:
            return connection.execute(
                "SELECT * FROM job_descriptions ORDER BY id DESC"
            ).fetchall()

    @router.post("", status_code=201)
    def create_jd(data: JDCreate):
        now = datetime.now(timezone.utc)

        with connect_db() as connection:
            return connection.execute(
                """
                INSERT INTO job_descriptions (
                    title, direction, content, created_at, updated_at, internal_notes, template_inputs
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING *
                """,
                (data.title, data.direction, data.content, now, now, data.internal_notes or "",
                 Jsonb(data.template_inputs.model_dump() if data.template_inputs else {})),
            ).fetchone()

    @router.put("/{jd_id}")
    def update_jd(jd_id: int, data: JDUpdate):
        now = datetime.now(timezone.utc)
        status = "approved" if data.approve else "draft"

        with connect_db() as connection:
            row = connection.execute(
                """
                UPDATE job_descriptions
                SET title = %s, direction = %s, content = %s,
                    status = %s, version = version + 1,
                    updated_at = %s, approved_at = %s,
                    internal_notes = COALESCE(%s, internal_notes),
                    template_inputs = COALESCE(%s, template_inputs)
                WHERE id = %s AND version = %s AND status = 'draft'
                RETURNING *
                """,
                (
                    data.title,
                    data.direction,
                    data.content,
                    status,
                    now,
                    now if data.approve else None,
                    data.internal_notes,
                    Jsonb(data.template_inputs.model_dump()) if data.template_inputs is not None else None,
                    jd_id,
                    data.version,
                ),
            ).fetchone()

            if row is None:
                exists = connection.execute(
                    "SELECT id FROM job_descriptions WHERE id = %s",
                    (jd_id,),
                ).fetchone()

                if exists is None:
                    raise HTTPException(404, "JD не найден")

                raise HTTPException(
                    409,
                    "JD уже изменён или утверждён. Обновите страницу.",
                )

        return row

    app.include_router(router)
