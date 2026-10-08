"""Reversible vacancy archive. Existing applications are retained."""
from datetime import datetime, timezone
from typing import Annotated, Literal
from fastapi import APIRouter, Header, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field


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
        with connect_db() as c:
            row = c.execute('SELECT id,vacancy_status,archived_at,archive_version FROM vacancies WHERE id=%s FOR UPDATE', (vacancy_id,)).fetchone()
            if row is None:
                raise HTTPException(404, 'Вакансия не найдена')
            if row['vacancy_status'] == data.status:
                return row
            if row['archive_version'] != data.version:
                raise HTTPException(409, 'Статус вакансии изменился в другой вкладке. Обновите страницу.')
            archived_at = datetime.now(timezone.utc) if data.status == 'archived' else None
            return c.execute('''UPDATE vacancies SET vacancy_status=%s,archived_at=%s,archive_version=archive_version+1 WHERE id=%s
                                RETURNING id,vacancy_status,archived_at,archive_version''',
                             (data.status, archived_at, vacancy_id)).fetchone()

    app.include_router(router)
