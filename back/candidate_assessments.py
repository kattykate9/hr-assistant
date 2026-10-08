"""Recruiter-authored criteria assessment. No external services are used."""
import hashlib
import json
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Header, HTTPException, Path
from psycopg.types.json import Jsonb
from pydantic import BaseModel, ConfigDict, Field

from db import SNAPSHOT

Rating = Literal['not_reviewed', 'confirmed', 'partial', 'not_confirmed', 'clarify']


class CriterionAnswer(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    key: str = Field(min_length=1, max_length=50)
    rating: Rating = 'not_reviewed'
    evidence: str = Field(default='', max_length=3000)
    questions: str = Field(default='', max_length=3000)


class AssessmentSave(BaseModel):
    model_config = ConfigDict(extra='forbid')
    version: int = Field(ge=0)
    criteria_token: str = Field(min_length=64, max_length=64)
    answers: list[CriterionAnswer] = Field(max_length=100)


def token(criteria):
    return hashlib.sha256(json.dumps(criteria, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def vacancy_criteria(c, application_id):
    app = c.execute('SELECT vacancy_id FROM applications WHERE id=%s', (application_id,)).fetchone()
    if app is None:
        raise HTTPException(404, 'Отклик не найден')
    vacancy = c.execute('SELECT * FROM vacancies WHERE id=%s', (app['vacancy_id'],)).fetchone()
    if vacancy is None:
        return [], False
    result = []
    for name, kind in [('criteria', 'required'), ('preferred_criteria', 'preferred')]:
        values = vacancy.get(name) or []
        if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
            raise HTTPException(500, 'Некорректные критерии вакансии')
        result.extend({'key': f'{kind}:{i}', 'text': value, 'kind': kind} for i, value in enumerate(values))
    return result, True


def match_summary(criteria, answers, saved=False, criteria_changed=False):
    by_key = {answer['key']: answer for answer in answers}
    values = [by_key.get(item['key'], {}).get('rating', 'not_reviewed') for item in criteria]
    total = len(values)
    reviewed = sum(value != 'not_reviewed' for value in values)
    has_assessment = bool(saved and reviewed)
    # Half-points keep the calculation exact; round to nearest integer, halves up.
    half_points = sum(2 if value == 'confirmed' else 1 if value == 'partial' else 0 for value in values)
    percent = (100 * half_points + total) // (2 * total) if total and has_assessment else 0
    return {'percent': percent, 'has_assessment': has_assessment, 'reviewed': reviewed if saved else 0,
            'total': total, 'preliminary': bool(has_assessment and (reviewed < total or 'clarify' in values)),
            'criteria_changed': criteria_changed}


def application_matches(c, rows):
    if not rows:
        return {}
    saved_rows = {row['application_id']: row for row in c.execute(
        'SELECT * FROM candidate_assessments WHERE application_id = ANY(%s)',
        ([row['id'] for row in rows],))}
    current_by_vacancy = {}
    result = {}
    for application in rows:
        vacancy_id = application['vacancy_id']
        if vacancy_id not in current_by_vacancy:
            current_by_vacancy[vacancy_id] = vacancy_criteria(c, application['id'])[0]
        current = current_by_vacancy[vacancy_id]
        saved = saved_rows.get(application['id'])
        criteria = saved['criteria_json'] if saved else current
        answers = saved['answers_json'] if saved else []
        result[application['id']] = match_summary(criteria, answers, bool(saved), bool(saved and token(criteria) != token(current)))
    return result


def read_assessment(c, application_id):
    current, available = vacancy_criteria(c, application_id)
    row = c.execute('SELECT * FROM candidate_assessments WHERE application_id=%s', (application_id,)).fetchone()
    criteria = row['criteria_json'] if row else current
    answers = row['answers_json'] if row else [
        {'key': criterion['key'], 'rating': 'not_reviewed', 'evidence': '', 'questions': ''} for criterion in criteria]
    return {'criteria': criteria, 'criteria_token': token(criteria), 'answers': answers,
            'version': row['version'] if row else 0, 'updated_at': row['updated_at'] if row else None,
            'criteria_changed': bool(row and token(current) != token(criteria)),
            'match': match_summary(criteria, answers, bool(row), bool(row and token(current) != token(criteria))),
            'vacancy_available': available, 'author_type': 'recruiter'}


def install_assessments(app, connect_db):
    router = APIRouter(prefix='/recruiting/applications', tags=['Ручная оценка'])

    @router.get('/{application_id}/assessment')
    def get_assessment(application_id: Annotated[int, Path(gt=0)]):
        with connect_db() as c:
            c.execute(SNAPSHOT)
            return read_assessment(c, application_id)

    @router.put('/{application_id}/assessment')
    def save_assessment(application_id: Annotated[int, Path(gt=0)], data: AssessmentSave,
                        x_hr_action: Annotated[str | None, Header()] = None):
        if x_hr_action != 'candidate-workflow':
            raise HTTPException(403, 'Сохраните оценку из кабинета')
        with connect_db() as c:
            # Блокировка отклика сериализует сохранения одной карточки.
            c.execute('SELECT id FROM applications WHERE id=%s FOR UPDATE', (application_id,))
            current = read_assessment(c, application_id)
            if data.criteria_token != current['criteria_token']:
                raise HTTPException(409, 'Критерии изменились. Скопируйте черновик и обновите карточку.')
            keys = [item['key'] for item in current['criteria']]
            supplied = [item.key for item in data.answers]
            if not keys or len(supplied) != len(keys) or set(supplied) != set(keys):
                raise HTTPException(422, 'Нужно передать каждый критерий ровно один раз')
            by_key = {item.key: item.model_dump() for item in data.answers}
            answers = [by_key[key] for key in keys]
            # A repeat after an uncertain response is harmless if the saved data match.
            if current['version'] > 0 and answers == current['answers']:
                return current
            if data.version != current['version']:
                raise HTTPException(409, 'Оценка изменена в другой вкладке. Скопируйте черновик и обновите страницу.')
            now = datetime.now(timezone.utc)
            c.execute('''INSERT INTO candidate_assessments(application_id,criteria_json,answers_json,version,updated_at)
                         VALUES(%s,%s,%s,%s,%s) ON CONFLICT(application_id) DO UPDATE SET
                         answers_json=excluded.answers_json,version=excluded.version,updated_at=excluded.updated_at''',
                      (application_id, Jsonb(current['criteria']), Jsonb(answers), current['version'] + 1, now))
            return read_assessment(c, application_id)

    app.include_router(router)
