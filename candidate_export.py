"""Explicit, authenticated CSV export of non-hh applications."""
import csv
import io
from typing import Annotated, Literal
from datetime import datetime, timezone
from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, AwareDatetime
from candidate_workflow import STAGES, ApplicationStatus, stage_history

ExportField = Literal['id','name','vacancy_title','contact','source','created_at','status','match_percent','resume_text','notes']
LABELS = {'id':'ID отклика','name':'ФИО','vacancy_title':'Вакансия','contact':'Контакт','source':'Источник','created_at':'Дата отклика (ISO 8601, UTC)','status':'Этап подбора','match_percent':'Оценка по критериям вакансии, %','resume_text':'Текст резюме','notes':'Заметки по этапам'}
class ExportFilters(BaseModel):
    model_config = ConfigDict(extra='forbid')
    status: ApplicationStatus | None = None
    vacancy_id: int | None = Field(default=None,gt=0)
    source: str | None = Field(default=None,min_length=1,max_length=100)
    q: str = Field(default='',max_length=200)
    assessment: Literal['all','none','assessed']='all'
    sort: Literal['date_desc','date_asc','match_desc','match_asc']='date_desc'
    created_from: AwareDatetime | None=None
    created_before: AwareDatetime | None=None
class ExportRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    mode: Literal['selected','filtered']
    fields: list[ExportField] = Field(min_length=1,max_length=10)
    ids: list[Annotated[int,Field(gt=0)]] = Field(default_factory=list,max_length=100)
    filters: ExportFilters = Field(default_factory=ExportFilters)

def safe_cell(value):
    text = str(value) if value is not None else ''
    # Neutralize spreadsheet formula execution, including leading whitespace/control chars.
    if text.lstrip('\ufeff \t\r\n\v\f').startswith(('=','+','-','@')) or text.startswith(('\t','\r','\n')):
        return "'" + text
    return text

def export_csv(c, rows, matches, request):
    output=io.StringIO(newline='');writer=csv.writer(output,lineterminator='\r\n')
    fields=list(dict.fromkeys(request.fields));writer.writerow([LABELS[k] for k in fields])
    size=0
    for row in rows:
        item=dict(row);summary=matches[row['id']]
        item['match_percent']=summary['percent'] if summary['has_assessment'] else ''
        item['status']=STAGES.get(item['status'],item['status'])
        item['created_at']=datetime.fromisoformat(item['created_at'].replace('Z','+00:00')).astimezone(timezone.utc).isoformat()
        if 'notes' in fields:
            groups=stage_history(c,row)
            item['notes']='\n'.join(f"{n['created_at']} | {STAGES.get(g['status'],g['status'])} | {n['text']}" for g in reversed(groups) for n in g['notes'])
        values=[safe_cell(item.get(k,'')) for k in fields]
        size+=sum(len(v.encode('utf-8')) for v in values)
        if size>8_000_000:raise HTTPException(413,'Экспорт больше 8 МБ. Сузьте фильтры или отключите резюме и заметки.')
        writer.writerow(values)
    content=('\ufeff'+output.getvalue()).encode('utf-8')
    if len(content)>10_000_000:raise HTTPException(413,'Слишком большой файл. Сузьте фильтры.')
    return Response(content,media_type='text/csv; charset=utf-8',headers={'Content-Disposition':'attachment; filename="applications.csv"','Cache-Control':'no-store','X-Export-Count':str(len(rows)),'X-Content-Type-Options':'nosniff'})
