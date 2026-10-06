"""Explicit recruiter flag; no messages are sent by this module."""
from contextlib import closing
from datetime import datetime,timezone
from typing import Annotated
from fastapi import APIRouter, Header, HTTPException, Path
from pydantic import BaseModel,ConfigDict,Field

def init_reply(cdb):
    with closing(cdb()) as c,c:
        c.execute('''CREATE TABLE IF NOT EXISTS application_reply_flags (
            application_id INTEGER PRIMARY KEY REFERENCES applications(id),
            needs_reply INTEGER NOT NULL CHECK(needs_reply IN (0,1)),
            version INTEGER NOT NULL,updated_at TEXT NOT NULL)''')

def read_reply(c,aid):
    r=c.execute('SELECT needs_reply,version,updated_at FROM application_reply_flags WHERE application_id=?',(aid,)).fetchone()
    return {'needs_reply':bool(r['needs_reply']),'version':r['version'],'updated_at':r['updated_at']} if r else {'needs_reply':False,'version':0,'updated_at':None}

class ReplySave(BaseModel):
    model_config=ConfigDict(extra='forbid')
    needs_reply: bool
    version:int=Field(ge=0)

def install_reply(app,cdb):
    router=APIRouter()
    @router.put('/recruiting/applications/{aid}/reply')
    def save(aid:Annotated[int,Path(gt=0)],data:ReplySave,x_hr_action:Annotated[str|None,Header()]=None):
        if x_hr_action!='candidate-workflow':raise HTTPException(403,'Используйте карточку кандидата')
        with closing(cdb()) as c,c:
            c.execute('BEGIN IMMEDIATE')
            if not c.execute('SELECT id FROM applications WHERE id=?',(aid,)).fetchone():raise HTTPException(404,'Отклик не найден')
            old=read_reply(c,aid)
            if old['needs_reply']==data.needs_reply:return old
            if old['version']!=data.version:raise HTTPException(409,'Отметка изменена в другой вкладке. Обновите карточку.')
            c.execute('INSERT INTO application_reply_flags VALUES(?,?,?,?) ON CONFLICT(application_id) DO UPDATE SET needs_reply=excluded.needs_reply,version=excluded.version,updated_at=excluded.updated_at',(aid,int(data.needs_reply),old['version']+1,datetime.now(timezone.utc).isoformat()))
            return read_reply(c,aid)
    app.include_router(router)
