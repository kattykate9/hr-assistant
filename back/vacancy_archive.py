"""Reversible vacancy archive. Existing applications are retained."""
from contextlib import closing
from datetime import datetime, timezone
from typing import Annotated, Literal
from fastapi import APIRouter, Header, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field


def init_vacancy_archive(connect_db):
    with closing(connect_db()) as c, c:
        c.execute('BEGIN IMMEDIATE')
        columns = {row['name'] for row in c.execute('PRAGMA table_info(vacancies)')}
        additions = {
            'vacancy_status': "TEXT NOT NULL DEFAULT 'active' CHECK(vacancy_status IN ('active','archived'))",
            'archived_at': 'TEXT',
            'archive_version': 'INTEGER NOT NULL DEFAULT 1',
        }
        for name, definition in additions.items():
            if name not in columns:
                c.execute(f'ALTER TABLE vacancies ADD COLUMN {name} {definition}')


class ArchiveChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: Literal['active', 'archived']
    version: int = Field(ge=1)


def install_vacancy_archive(app, connect_db):
    router = APIRouter(prefix='/vacancies', tags=['Архив вакансий'])

    @router.patch('/{vacancy_id}/status')
    def change(vacancy_id: Annotated[int, Path(gt=0)], data: ArchiveChange,
               x_hr_action: Annotated[str | None, Header()] = None):
        if x_hr_action != 'candidate-workflow':
            raise HTTPException(403, 'Измените статус из кабинета')
        with closing(connect_db()) as c, c:
            c.execute('BEGIN IMMEDIATE')
            row = c.execute('SELECT id,vacancy_status,archived_at,archive_version FROM vacancies WHERE id=?', (vacancy_id,)).fetchone()
            if row is None:
                raise HTTPException(404, 'Вакансия не найдена')
            if row['vacancy_status'] == data.status:
                return dict(row)
            if row['archive_version'] != data.version:
                raise HTTPException(409, 'Статус вакансии изменился в другой вкладке. Обновите страницу.')
            archived_at = datetime.now(timezone.utc).isoformat() if data.status == 'archived' else None
            c.execute('UPDATE vacancies SET vacancy_status=?,archived_at=?,archive_version=archive_version+1 WHERE id=?',
                      (data.status, archived_at, vacancy_id))
            return dict(c.execute('SELECT id,vacancy_status,archived_at,archive_version FROM vacancies WHERE id=?',(vacancy_id,)).fetchone())

    app.include_router(router)
