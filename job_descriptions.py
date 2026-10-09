import json
from ai_jd import JDInputs, generate_jd_draft
from contextlib import closing
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
    title: str = Field(min_length=1,max_length=200)
    direction: Literal["traffic", "development", "roblox"]
    inputs: JDInputs
    share_with_openai: bool = False


def install_jd(app, connect_db):
    router = APIRouter(prefix="/job-descriptions", tags=["Job Description"])

    with closing(connect_db()) as connection:
        with connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS job_descriptions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    content TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'draft',
                    version INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    approved_at TEXT
                )
            """)

    # Additive migration: legacy JD text, statuses and versions stay intact.
            columns={row[1] for row in connection.execute("PRAGMA table_info(job_descriptions)")}
            if "internal_notes" not in columns:
                connection.execute("ALTER TABLE job_descriptions ADD COLUMN internal_notes TEXT NOT NULL DEFAULT ''")
            if "template_inputs" not in columns:
                connection.execute("ALTER TABLE job_descriptions ADD COLUMN template_inputs TEXT NOT NULL DEFAULT '{}'")

    @router.post("/ai-draft")
    def prepare_jd(data: JDDraftRequest):
        return generate_jd_draft(data)

    @router.get("")
    def list_jds():
        with closing(connect_db()) as connection:
            rows = connection.execute(
                "SELECT * FROM job_descriptions ORDER BY id DESC"
            ).fetchall()
        return [dict(row) for row in rows]

    @router.post("", status_code=201)
    def create_jd(data: JDCreate):
        now = datetime.now(timezone.utc).isoformat()

        with closing(connect_db()) as connection:
            with connection:
                cursor = connection.execute(
                    """
                    INSERT INTO job_descriptions (
                        title, direction, content, created_at, updated_at, internal_notes, template_inputs
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (data.title, data.direction, data.content, now, now, data.internal_notes or "", json.dumps(data.template_inputs.model_dump() if data.template_inputs else {}, ensure_ascii=False)),
                )
                row = connection.execute(
                    "SELECT * FROM job_descriptions WHERE id = ?",
                    (cursor.lastrowid,),
                ).fetchone()

        return dict(row)

    @router.put("/{jd_id}")
    def update_jd(jd_id: int, data: JDUpdate):
        now = datetime.now(timezone.utc).isoformat()
        status = "approved" if data.approve else "draft"

        with closing(connect_db()) as connection:
            with connection:
                cursor = connection.execute(
                    """
                    UPDATE job_descriptions
                    SET title = ?, direction = ?, content = ?,
                        status = ?, version = version + 1,
                        updated_at = ?, approved_at = ?, internal_notes = COALESCE(?, internal_notes), template_inputs = COALESCE(?, template_inputs)
                    WHERE id = ? AND version = ? AND status = 'draft'
                    """,
                    (
                        data.title,
                        data.direction,
                        data.content,
                        status,
                        now,
                        now if data.approve else None,
                        data.internal_notes,
                        json.dumps(data.template_inputs.model_dump(), ensure_ascii=False) if data.template_inputs is not None else None,
                        jd_id,
                        data.version,
                    ),
                )

                if cursor.rowcount != 1:
                    exists = connection.execute(
                        "SELECT id FROM job_descriptions WHERE id = ?",
                        (jd_id,),
                    ).fetchone()

                    if exists is None:
                        raise HTTPException(404, "JD не найден")

                    raise HTTPException(
                        409,
                        "JD уже изменён или утверждён. Обновите страницу.",
                    )

                row = connection.execute(
                    "SELECT * FROM job_descriptions WHERE id = ?",
                    (jd_id,),
                ).fetchone()

        return dict(row)

    app.include_router(router)