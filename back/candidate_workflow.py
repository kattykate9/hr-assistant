"""Local recruiter workflow; decisions are made by the recruiter."""
from candidate_assessments import read_assessment, install_assessments
from candidate_tasks import read_task, install_tasks
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field

from db import SNAPSHOT

ApplicationStatus = Literal['new', 'screening', 'interview', 'test', 'offer', 'hired', 'rejected']
STAGES = {'new': 'Новый', 'screening': 'Скрининг', 'interview': 'Интервью',
          'test': 'Тестовое', 'offer': 'Оффер', 'hired': 'Нанят', 'rejected': 'Отказ'}


class StageChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: ApplicationStatus
    version: int = Field(ge=1)


class NoteCreate(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    text: str = Field(min_length=1, max_length=5000)
    request_id: UUID
    version: int = Field(ge=1)


def stage_history(c, application):
    # Read the full chronology so an old stage is retained even after 100 notes.
    events = c.execute('SELECT * FROM application_events WHERE application_id=%s ORDER BY id', (application['id'],)).fetchall()
    first_stage = next((event for event in events if event['event_type'] == 'stage'), None)
    initial = first_stage['old_status'] if first_stage else application['status']
    groups = [{'id': 0, 'status': initial, 'started_at': application['created_at'], 'notes': []}]
    for event in events:
        if event['event_type'] == 'stage':
            groups.append({'id': event['id'], 'status': event['new_status'], 'started_at': event['created_at'], 'notes': []})
        else:
            groups[-1]['notes'].append({'id': event['id'], 'text': event['note'], 'created_at': event['created_at']})
    return list(reversed(groups))


def read_card(c, application_id):
    row = c.execute('''SELECT a.*, v.title AS vacancy_title FROM applications a
                       LEFT JOIN vacancies v ON v.id=a.vacancy_id WHERE a.id=%s''', (application_id,)).fetchone()
    if row is None:
        raise HTTPException(404, 'Отклик не найден')
    from recruitment_views import settings
    events = c.execute('SELECT * FROM application_events WHERE application_id=%s ORDER BY id DESC LIMIT 100', (application_id,)).fetchall()
    total = c.execute('SELECT COUNT(*) AS n FROM application_events WHERE application_id=%s', (application_id,)).fetchone()['n']
    return {'application': row, 'events': events,
            'next_action': read_task(c, application_id), 'assessment': read_assessment(c, application_id), 'events_total': total, 'stage_history': stage_history(c, row), 'timezone': settings(c)['report_timezone'], 'stages': STAGES}


def require_action(value):
    if value != 'candidate-workflow':
        raise HTTPException(403, 'Запрос изменения должен быть отправлен из кабинета')


def install_candidate_workflow(app, connect_db):
    router = APIRouter(prefix='/recruiting/applications', tags=['Карточки кандидатов'])

    @router.get('/{application_id}')
    def card(application_id: Annotated[int, Path(gt=0)]):
        with connect_db() as c:
            c.execute(SNAPSHOT)
            return read_card(c, application_id)

    @router.patch('/{application_id}/stage')
    def stage(application_id: Annotated[int, Path(gt=0)], data: StageChange,
              x_hr_action: Annotated[str | None, Header()] = None):
        require_action(x_hr_action)
        with connect_db() as c:
            current = c.execute('SELECT status, review_version FROM applications WHERE id=%s FOR UPDATE', (application_id,)).fetchone()
            if current is None:
                raise HTTPException(404, 'Отклик не найден')
            if current['review_version'] != data.version:
                raise HTTPException(409, 'Карточка изменена в другой вкладке. Обновите страницу перед сохранением.')
            if current['status'] != data.status:
                c.execute('UPDATE applications SET status=%s, review_version=review_version+1 WHERE id=%s', (data.status, application_id))
                c.execute('''INSERT INTO application_events(application_id,event_type,old_status,new_status,created_at)
                             VALUES(%s,'stage',%s,%s,%s)''', (application_id,current['status'],data.status,datetime.now(timezone.utc)))
            return read_card(c, application_id)

    @router.post('/{application_id}/notes')
    def note(application_id: Annotated[int, Path(gt=0)], data: NoteCreate,
             x_hr_action: Annotated[str | None, Header()] = None):
        require_action(x_hr_action)
        with connect_db() as c:
            current = c.execute('SELECT status, review_version FROM applications WHERE id=%s FOR UPDATE', (application_id,)).fetchone()
            if current is None:
                raise HTTPException(404, 'Отклик не найден')
            duplicate = c.execute('SELECT note FROM application_events WHERE application_id=%s AND request_id=%s', (application_id,str(data.request_id))).fetchone()
            if duplicate:
                if duplicate['note'] != data.text:
                    raise HTTPException(409, 'Этот запрос уже сохранил другую заметку. Обновите карточку.')
                return read_card(c, application_id)
            if current['review_version'] != data.version:
                raise HTTPException(409, 'Карточка изменена в другой вкладке. Скопируйте черновик и обновите страницу.')
            c.execute('''INSERT INTO application_events(application_id,event_type,note,request_id,created_at,new_status)
                         VALUES(%s,'note',%s,%s,%s,%s)''', (application_id,data.text,str(data.request_id),datetime.now(timezone.utc),current['status']))
            c.execute('UPDATE applications SET review_version=review_version+1 WHERE id=%s', (application_id,))
            return read_card(c, application_id)

    app.include_router(router)
    install_assessments(app, connect_db)
    install_tasks(app, connect_db)
