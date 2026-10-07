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


class JDUpdate(JDCreate):
    version: int = Field(ge=1)
    approve: bool = False


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
                        title, direction, content, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (data.title, data.direction, data.content, now, now),
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
                        updated_at = ?, approved_at = ?
                    WHERE id = ? AND version = ? AND status = 'draft'
                    """,
                    (
                        data.title,
                        data.direction,
                        data.content,
                        status,
                        now,
                        now if data.approve else None,
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