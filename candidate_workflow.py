from candidate_ai import init_ai, read_ai, install_ai
from candidate_messages import init_messages, install_messages
from reply_tracking import init_reply, read_reply, install_reply
"""Local recruiter workflow; decisions are made by the recruiter."""
from candidate_assessments import init_assessments, read_assessment, install_assessments
from candidate_tasks import init_tasks, read_task, install_tasks
from contextlib import closing
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Path
from pydantic import BaseModel, ConfigDict, Field

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


def init_candidate_workflow(connect_db):
    with closing(connect_db()) as c, c:
        c.execute('BEGIN IMMEDIATE')
        columns = {row[1] for row in c.execute('PRAGMA table_info(applications)')}
        if 'review_version' not in columns:
            c.execute('ALTER TABLE applications ADD COLUMN review_version INTEGER NOT NULL DEFAULT 1')
        c.execute('''CREATE TABLE IF NOT EXISTS application_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER NOT NULL REFERENCES applications(id),
            event_type TEXT NOT NULL CHECK(event_type IN ('stage','note')),
            old_status TEXT, new_status TEXT, note TEXT,
            request_id TEXT, created_at TEXT NOT NULL,
            UNIQUE(application_id, request_id)
        )''')
        c.execute('CREATE INDEX IF NOT EXISTS application_events_app ON application_events(application_id, id)')
        c.execute('CREATE INDEX IF NOT EXISTS applications_stage ON applications(status)')

    init_assessments(connect_db)
    init_tasks(connect_db)
    init_reply(connect_db)
    init_messages(connect_db)
    init_ai(connect_db)


def stage_history(c, application):
    # Read the full chronology so an old stage is retained even after 100 notes.
    events = c.execute('SELECT * FROM application_events WHERE application_id=? ORDER BY id', (application['id'],)).fetchall()
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
                       LEFT JOIN vacancies v ON v.id=a.vacancy_id WHERE a.id=?''', (application_id,)).fetchone()
    if row is None:
        raise HTTPException(404, 'Отклик не найден')
    from recruitment_views import settings
    events = c.execute('SELECT * FROM application_events WHERE application_id=? ORDER BY id DESC LIMIT 100', (application_id,)).fetchall()
    total = c.execute('SELECT COUNT(*) FROM application_events WHERE application_id=?', (application_id,)).fetchone()[0]
    return {'ai_assessment':read_ai(c,application_id),'reply_tracking':read_reply(c,application_id),'application': dict(row), 'events': [dict(e) for e in events],
            'next_action': read_task(c, application_id), 'assessment': read_assessment(c, application_id), 'events_total': total, 'stage_history': stage_history(c, row), 'timezone': settings(c)['report_timezone'], 'stages': STAGES}


def require_action(value):
    if value != 'candidate-workflow':
        raise HTTPException(403, 'Запрос изменения должен быть отправлен из кабинета')


def install_candidate_workflow(app, connect_db):
    router = APIRouter(prefix='/recruiting/applications', tags=['Карточки кандидатов'])

    @router.get('/{application_id}')
    def card(application_id: Annotated[int, Path(gt=0)]):
        with closing(connect_db()) as c:
            c.execute('BEGIN')
            return read_card(c, application_id)

    @router.patch('/{application_id}/stage')
    def stage(application_id: Annotated[int, Path(gt=0)], data: StageChange,
              x_hr_action: Annotated[str | None, Header()] = None):
        require_action(x_hr_action)
        with closing(connect_db()) as c, c:
            c.execute('BEGIN IMMEDIATE')
            current = c.execute('SELECT status, review_version FROM applications WHERE id=?', (application_id,)).fetchone()
            if current is None:
                raise HTTPException(404, 'Отклик не найден')
            if current['review_version'] != data.version:
                raise HTTPException(409, 'Карточка изменена в другой вкладке. Обновите страницу перед сохранением.')
            if current['status'] != data.status:
                c.execute('UPDATE applications SET status=?, review_version=review_version+1 WHERE id=?', (data.status, application_id))
                c.execute('''INSERT INTO application_events(application_id,event_type,old_status,new_status,created_at)
                             VALUES(?,'stage',?,?,?)''', (application_id,current['status'],data.status,datetime.now(timezone.utc).isoformat()))
            return read_card(c, application_id)

    @router.post('/{application_id}/notes')
    def note(application_id: Annotated[int, Path(gt=0)], data: NoteCreate,
             x_hr_action: Annotated[str | None, Header()] = None):
        require_action(x_hr_action)
        with closing(connect_db()) as c, c:
            c.execute('BEGIN IMMEDIATE')
            current = c.execute('SELECT status, review_version FROM applications WHERE id=?', (application_id,)).fetchone()
            if current is None:
                raise HTTPException(404, 'Отклик не найден')
            duplicate = c.execute('SELECT note FROM application_events WHERE application_id=? AND request_id=?', (application_id,str(data.request_id))).fetchone()
            if duplicate:
                if duplicate['note'] != data.text:
                    raise HTTPException(409, 'Этот запрос уже сохранил другую заметку. Обновите карточку.')
                return read_card(c, application_id)
            if current['review_version'] != data.version:
                raise HTTPException(409, 'Карточка изменена в другой вкладке. Скопируйте черновик и обновите страницу.')
            c.execute('''INSERT INTO application_events(application_id,event_type,note,request_id,created_at,new_status)
                         VALUES(?,'note',?,?,?,?)''', (application_id,data.text,str(data.request_id),datetime.now(timezone.utc).isoformat(),current['status']))
            c.execute('UPDATE applications SET review_version=review_version+1 WHERE id=?', (application_id,))
            return read_card(c, application_id)

    app.include_router(router)
    install_reply(app,connect_db)
    install_messages(app,connect_db)
    install_ai(app,connect_db)
    install_assessments(app, connect_db)
    install_tasks(app, connect_db)
