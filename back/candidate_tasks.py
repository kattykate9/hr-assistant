"""One next action per application, with a durable change history."""
import json
from contextlib import closing
from datetime import datetime, time, timedelta, timezone
from typing import Annotated, Literal
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Header, HTTPException, Path, Query
from pydantic import BaseModel, ConfigDict, Field


def utc_now():
    return datetime.now(timezone.utc)


def init_tasks(connect_db):
    with closing(connect_db()) as c, c:
        c.execute('''CREATE TABLE IF NOT EXISTS candidate_tasks (
            application_id INTEGER PRIMARY KEY REFERENCES applications(id),
            title TEXT NOT NULL, comment TEXT NOT NULL, due_at TEXT NOT NULL,
            completed_at TEXT, version INTEGER NOT NULL, updated_at TEXT NOT NULL
        )''')
        c.execute('''CREATE TABLE IF NOT EXISTS candidate_task_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            application_id INTEGER NOT NULL REFERENCES applications(id),
            action TEXT NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL
        )''')
        c.execute('CREATE INDEX IF NOT EXISTS candidate_task_events_app ON candidate_task_events(application_id,id)')


def task_zone(c):
    from recruitment_views import settings
    return settings(c)['report_timezone']


def parse_deadline(local, zone):
    try:
        naive = datetime.fromisoformat(local)
        if naive.tzinfo is not None or naive.second or naive.microsecond:
            raise ValueError()
        tz = ZoneInfo(zone)
        candidates = set()
        for fold in (0, 1):
            instant = naive.replace(tzinfo=tz, fold=fold).astimezone(timezone.utc)
            if instant.astimezone(tz).replace(tzinfo=None) == naive:
                candidates.add(instant)
        if len(candidates) != 1:
            raise HTTPException(422, 'Время попадает на перевод часов. Выберите другое время, например на час позже.')
        return candidates.pop().isoformat()
    except (ValueError, TypeError):
        raise HTTPException(422, 'Укажите корректную дату и время с точностью до минуты')


def task_item(row, zone, now):
    if row is None:
        return None
    result = dict(row)
    due = datetime.fromisoformat(result['due_at'])
    result['due_local'] = due.astimezone(ZoneInfo(zone)).strftime('%Y-%m-%dT%H:%M')
    result['overdue'] = not result['completed_at'] and due < now
    return result


def read_task(c, application_id):
    if not c.execute('SELECT id FROM applications WHERE id=?',(application_id,)).fetchone():
        raise HTTPException(404, 'Отклик не найден')
    zone = task_zone(c); now = utc_now()
    row = c.execute('SELECT * FROM candidate_tasks WHERE application_id=?',(application_id,)).fetchone()
    events = c.execute('SELECT * FROM candidate_task_events WHERE application_id=? ORDER BY id DESC LIMIT 20',(application_id,)).fetchall()
    return {'task':task_item(row,zone,now), 'timezone':zone, 'generated_at':now.isoformat(),
            'history':[{'id':e['id'],'action':e['action'],'created_at':e['created_at'],'task':json.loads(e['snapshot'])} for e in events]}


def list_task_items(c, rows):
    if not rows: return {}
    zone=task_zone(c);now=utc_now()
    return {r['application_id']:task_item(r,zone,now) for r in c.execute(
        'SELECT * FROM candidate_tasks WHERE completed_at IS NULL AND application_id IN ('+','.join('?' for _ in rows)+')',
        [r['id'] for r in rows])}


def task_overview(c, exclude_hh=False, include_items=True):
    zone=task_zone(c);now=utc_now();tz=ZoneInfo(zone)
    next_day=datetime.combine(now.astimezone(tz).date()+timedelta(days=1),time.min,tz).astimezone(timezone.utc)
    scope=" AND a.source != 'hh'" if exclude_hh else ''
    rows=c.execute('''SELECT t.*,a.name,a.source,v.title AS vacancy_title FROM candidate_tasks t
         JOIN applications a ON a.id=t.application_id LEFT JOIN vacancies v ON v.id=a.vacancy_id
         WHERE t.completed_at IS NULL'''+scope+' ORDER BY t.due_at,t.application_id').fetchall()
    overdue=[];today=[]
    for row in rows:
        due=datetime.fromisoformat(row['due_at'])
        if due<now:overdue.append(row)
        elif due<next_day:today.append(row)
    result={'timezone':zone,'generated_at':now.isoformat(),'overdue_count':len(overdue),'today_count':len(today),'open_count':len(rows)}
    if include_items:
        result['overdue']=[task_item(r,zone,now) for r in overdue[:100]]
        result['today']=[task_item(r,zone,now) for r in today[:100]]
    return result


class TaskSave(BaseModel):
    model_config=ConfigDict(extra='forbid',str_strip_whitespace=True)
    version:int=Field(ge=0)
    title:str=Field(min_length=1,max_length=200)
    comment:str=Field(default='',max_length=3000)
    due_local:str=Field(min_length=16,max_length=19)
    timezone:str=Field(min_length=1,max_length=100)


class TaskComplete(BaseModel):
    model_config=ConfigDict(extra='forbid')
    version:int=Field(ge=1)


def install_tasks(app,connect_db):
    router=APIRouter(prefix='/recruiting',tags=['Действия по кандидатам'])
    def authorize(value):
        if value!='candidate-workflow':raise HTTPException(403,'Сохраните действие из кабинета')
    def record(c,application_id,action):
        row=dict(c.execute('SELECT * FROM candidate_tasks WHERE application_id=?',(application_id,)).fetchone())
        c.execute('INSERT INTO candidate_task_events(application_id,action,snapshot,created_at) VALUES(?,?,?,?)',
                  (application_id,action,json.dumps(row,ensure_ascii=False),row['updated_at']))

    @router.get('/tasks')
    def overview():
        with closing(connect_db()) as c:
            c.execute('BEGIN');return task_overview(c)

    @router.get('/tasks/list')
    def task_list(
        status: Literal['all', 'planned', 'overdue', 'completed'] = 'all',
        page: Annotated[int, Query(ge=1)] = 1,
        page_size: Annotated[int, Query(ge=1, le=100)] = 30,
    ):
        with closing(connect_db()) as c:
            c.execute('BEGIN')
            zone = task_zone(c); now = utc_now(); instant = now.isoformat()
            predicates = {
                'all': '1=1',
                'planned': 't.completed_at IS NULL AND julianday(t.due_at) >= julianday(?)',
                'overdue': 't.completed_at IS NULL AND julianday(t.due_at) < julianday(?)',
                'completed': 't.completed_at IS NOT NULL',
            }
            joins = 'FROM candidate_tasks t JOIN applications a ON a.id=t.application_id LEFT JOIN vacancies v ON v.id=a.vacancy_id'
            counts = {}
            for key, clause in predicates.items():
                args = (instant,) if key in ('planned','overdue') else ()
                counts[key] = c.execute(f'SELECT COUNT(*) {joins} WHERE {clause}', args).fetchone()[0]
            total = counts[status]; pages = max(1, (total + page_size - 1) // page_size); page = min(page, pages)
            params = [instant] if status in ('planned','overdue') else []
            rows = c.execute(f"""SELECT t.*,a.name,a.source,v.title AS vacancy_title {joins}
                WHERE {predicates[status]} ORDER BY julianday(t.updated_at) DESC,t.application_id DESC LIMIT ? OFFSET ?""",
                [*params,page_size,(page-1)*page_size]).fetchall()
            return {'items':[task_item(row,zone,now) for row in rows], 'counts':counts,
                    'total':total,'page':page,'pages':pages,'page_size':page_size,'status':status,
                    'timezone':zone,'generated_at':instant}

    @router.get('/applications/{application_id}/task')
    def get(application_id:Annotated[int,Path(gt=0)]):
        with closing(connect_db()) as c:
            c.execute('BEGIN');return read_task(c,application_id)

    @router.put('/applications/{application_id}/task')
    def save(application_id:Annotated[int,Path(gt=0)],data:TaskSave,x_hr_action:Annotated[str|None,Header()]=None):
        authorize(x_hr_action)
        with closing(connect_db()) as c,c:
            c.execute('BEGIN IMMEDIATE');state=read_task(c,application_id);old=state['task']
            if data.timezone!=state['timezone']:raise HTTPException(409,'Часовой пояс кабинета изменился. Обновите карточку.')
            due=parse_deadline(data.due_local,data.timezone)
            if old and not old['completed_at'] and (old['title'],old['comment'],old['due_at'])==(data.title,data.comment,due):return state
            if data.version!=(old['version'] if old else 0):raise HTTPException(409,'Действие изменено в другой вкладке. Скопируйте черновик и обновите страницу.')
            now=utc_now().isoformat()
            c.execute('''INSERT INTO candidate_tasks VALUES(?,?,?,?,NULL,?,?) ON CONFLICT(application_id) DO UPDATE SET
                title=excluded.title,comment=excluded.comment,due_at=excluded.due_at,completed_at=NULL,
                version=excluded.version,updated_at=excluded.updated_at''',(application_id,data.title,data.comment,due,data.version+1,now))
            record(c,application_id,'created' if not old or old['completed_at'] else 'updated')
            return read_task(c,application_id)

    @router.post('/applications/{application_id}/task/complete')
    def complete(application_id:Annotated[int,Path(gt=0)],data:TaskComplete,x_hr_action:Annotated[str|None,Header()]=None):
        authorize(x_hr_action)
        with closing(connect_db()) as c,c:
            c.execute('BEGIN IMMEDIATE');state=read_task(c,application_id);old=state['task']
            if not old:raise HTTPException(404,'Действие не найдено')
            if old['completed_at'] and old['version']==data.version+1:return state
            if data.version!=old['version']:raise HTTPException(409,'Действие изменилось. Обновите карточку.')
            if old['completed_at']:return state
            now=utc_now().isoformat()
            c.execute('UPDATE candidate_tasks SET completed_at=?,updated_at=?,version=version+1 WHERE application_id=?',(now,now,application_id))
            record(c,application_id,'completed');return read_task(c,application_id)
    app.include_router(router)
