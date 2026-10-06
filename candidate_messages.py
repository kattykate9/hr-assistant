"""Two-step Telegram send with durable at-most-once attempts and no retries."""
import json,os,re,urllib.request,urllib.error,ssl,socket
import certifi
from contextlib import closing
from pathlib import Path as FilePath
from datetime import datetime,timezone,timedelta
from uuid import UUID,uuid4
from typing import Annotated,Literal
from fastapi import APIRouter,Header,HTTPException,Path
from pydantic import BaseModel,ConfigDict,Field
from dotenv import dotenv_values

def now():return datetime.now(timezone.utc)
def credentials():
    token=(os.getenv('TELEGRAM_BOT_TOKEN') or dotenv_values(FilePath(__file__).resolve().parent/'.env').get('TELEGRAM_BOT_TOKEN') or '').strip()
    return (token,token.split(':')[0]) if re.fullmatch(r'[0-9]+:[A-Za-z0-9_-]+',token) else ('','')
def init_messages(db):
    with closing(db()) as c,c:
        c.execute('''CREATE TABLE IF NOT EXISTS candidate_messages (
            request_id TEXT PRIMARY KEY,application_id INTEGER NOT NULL REFERENCES applications(id),
            chat_id INTEGER NOT NULL,bot_id TEXT NOT NULL,text TEXT NOT NULL,
            status TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
            telegram_message_id INTEGER)''')
        c.execute('CREATE INDEX IF NOT EXISTS candidate_messages_app ON candidate_messages(application_id,created_at)')
def public(row):
    return {k:row[k] for k in ['request_id','text','status','detail','created_at','updated_at']}
def recipient(c,aid):
    a=c.execute('SELECT id,name,source FROM applications WHERE id=?',(aid,)).fetchone()
    if not a:raise HTTPException(404,'Отклик не найден')
    r=c.execute('SELECT chat_id FROM application_telegram_recipients WHERE application_id=?',(aid,)).fetchone()
    return a, r['chat_id'] if r and a['source']=='telegram' else None

def tls_context():
    return ssl.create_default_context(cafile=certifi.where())

def network_detail(error):
    reason=getattr(error,'reason',error)
    if isinstance(reason,ssl.SSLCertVerificationError):
        return 'not_sent','Не удалось проверить сертификат Telegram. Сообщение не отправлено. Проверьте дату на Mac и сертификаты Python; проверка TLS остаётся включённой.'
    if isinstance(reason,ssl.SSLError):
        return 'unknown','Ошибка защищённого соединения. Результат отправки не подтверждён; автоматического повтора нет.'
    if isinstance(reason,socket.gaierror):
        return 'not_sent','Не удалось определить адрес Telegram (DNS). Сообщение не отправлено. Проверьте интернет или VPN.'
    if isinstance(reason,ConnectionRefusedError):
        return 'not_sent','Соединение с Telegram отклонено до отправки. Проверьте интернет, VPN или прокси.'
    return 'unknown','Нет подтверждения Telegram: тайм-аут или обрыв связи. Сообщение могло уйти; автоматического повтора нет.'

def check_connection():
    token,bot_id=credentials()
    if not token:return False,'Не настроен TELEGRAM_BOT_TOKEN.'
    try:
        request=urllib.request.Request('https://api.telegram.org/bot'+token+'/getMe',method='GET')
        with urllib.request.urlopen(request,timeout=12,context=tls_context()) as response:data=json.load(response)
        info=data.get('result',{})
        if data.get('ok') is True and str(info.get('id'))==bot_id:
            return True,'Связь с Telegram подтверждена. Бот: @'+str(info.get('username',''))
        return False,'Telegram не подтвердил данные бота. Проверьте токен в корневом .env.'
    except urllib.error.HTTPError as exc:
        return False,('Telegram отклонил токен. Проверьте TELEGRAM_BOT_TOKEN в корневом .env.' if exc.code in (401,404) else 'Telegram временно не подтвердил доступ. Код ответа: '+str(exc.code))
    except Exception as exc:
        return False,network_detail(exc)[1]

def send_once(token,chat_id,text):
    payload=json.dumps({'chat_id':chat_id,'text':text,'link_preview_options':{'is_disabled':True}},ensure_ascii=False).encode()
    req=urllib.request.Request('https://api.telegram.org/bot'+token+'/sendMessage',data=payload,headers={'Content-Type':'application/json'},method='POST')
    try:
        with urllib.request.urlopen(req,timeout=15,context=tls_context()) as response:data=json.load(response)
        result=data.get('result',{})
        if data.get('ok') is True and result.get('chat',{}).get('id')==chat_id and isinstance(result.get('message_id'),int):
            return 'sent','Telegram принял сообщение. Прочтение не подтверждено.',result['message_id']
        return 'unknown','Не удалось подтвердить отправку. Проверьте диалог; автоматического повтора нет.',None
    except urllib.error.HTTPError as exc:
        if exc.code in (400,401,403,404,429):
            return 'rejected',('Telegram отклонил отправку. Возможно, кандидат заблокировал бота или чат недоступен.' if exc.code==403 else 'Telegram отклонил отправку. Проверьте доступность бота, текст и ограничения Telegram.'),None
        return 'unknown','Ответ Telegram не подтверждает результат. Проверьте диалог перед новой отправкой.',None
    except Exception as exc:
        # Never include exception/URL/token in user output or logs.
        status,detail=network_detail(exc)
        return status,detail,None

class Prepare(BaseModel):
    model_config=ConfigDict(extra='forbid')
    text:str=Field(min_length=1,max_length=4000)
class Confirmation(BaseModel):
    model_config=ConfigDict(extra='forbid')
    confirmed:Literal[True]
def guard(action):
    if action!='candidate-workflow':raise HTTPException(403,'Отправляйте из карточки кандидата')

def install_messages(app,db):
    router=APIRouter(prefix='/recruiting/applications')
    @router.get('/{aid}/messages')
    def history(aid:Annotated[int,Path(gt=0)]):
        with closing(db()) as c:
            a,chat=recipient(c,aid);token,_=credentials()
            rows=c.execute("SELECT * FROM candidate_messages WHERE application_id=? AND status!='draft' ORDER BY created_at DESC,rowid DESC LIMIT 30",(aid,)).fetchall()
            return {'available':bool(chat and token),'recipient':a['name'],'chat_id':str(chat) if chat else None,
                    'reason':('Нет сохранённого Telegram-адресата. Доступно копирование текста.' if not chat else 'Не настроен токен Telegram-бота.' if not token else ''),
                    'items':[public(r) for r in rows]}
    @router.post('/{aid}/messages/prepare')
    def prepare(aid:Annotated[int,Path(gt=0)],data:Prepare,x_hr_action:Annotated[str|None,Header()]=None):
        guard(x_hr_action)
        if not data.text.strip():raise HTTPException(422,'Напишите сообщение')
        if len(data.text.encode('utf-16-le'))//2>4000:raise HTTPException(422,'Сообщение слишком длинное. Сократите до 4000 символов.')
        token,bot_id=credentials()
        if not token:raise HTTPException(503,'Не настроен Telegram-бот')
        ok,detail=check_connection()
        if not ok:raise HTTPException(503,detail)
        with closing(db()) as c,c:
            c.execute('BEGIN IMMEDIATE');a,chat=recipient(c,aid)
            if not chat:raise HTTPException(409,'У отклика нет Telegram-адресата')
            recent=c.execute("SELECT * FROM candidate_messages WHERE application_id=? AND text=? AND chat_id=? AND bot_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",(aid,data.text,chat,bot_id)).fetchone()
            if recent and (recent['status'] in ('sending','unknown') or (recent['status'] in ('draft','sent') and now()-datetime.fromisoformat(recent['created_at'])<timedelta(minutes=15))):
                if recent['status']!='draft':raise HTTPException(409,'Такое сообщение уже отправлялось. Проверьте историю и диалог; повтор сейчас заблокирован.')
                item=public(recent)
            else:
                uid=str(uuid4());stamp=now().isoformat()
                c.execute('INSERT INTO candidate_messages(request_id,application_id,chat_id,bot_id,text,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',(uid,aid,chat,bot_id,data.text,'draft',stamp,stamp))
                item=public(c.execute('SELECT * FROM candidate_messages WHERE request_id=?',(uid,)).fetchone())
            return {'message':item,'recipient':a['name'],'chat_id':str(chat),'channel':'Telegram — бот компании'}
    @router.post('/{aid}/messages/{request_id}/send')
    def confirm(aid:Annotated[int,Path(gt=0)],request_id:UUID,data:Confirmation,x_hr_action:Annotated[str|None,Header()]=None):
        guard(x_hr_action);token,bot_id=credentials()
        with closing(db()) as c,c:
            c.execute('BEGIN IMMEDIATE')
            row=c.execute('SELECT * FROM candidate_messages WHERE request_id=? AND application_id=?',(str(request_id),aid)).fetchone()
            if not row:raise HTTPException(404,'Предпросмотр не найден')
            if row['status']!='draft':return public(row)
            a,chat=recipient(c,aid)
            if not token or row['bot_id']!=bot_id or row['chat_id']!=chat:raise HTTPException(409,'Адресат или бот изменился. Подготовьте сообщение заново.')
            if now()-datetime.fromisoformat(row['created_at'])>timedelta(minutes=15):raise HTTPException(409,'Предпросмотр устарел. Подготовьте сообщение заново.')
            c.execute("UPDATE candidate_messages SET status='sending',detail=?,updated_at=? WHERE request_id=?",('Попытка начата. Если статус не меняется, результат не подтверждён; повтор запрещён.',now().isoformat(),str(request_id)))
            text=row['text']
        # Commit the claim before network IO. A crash cannot lead to automatic resend.
        status,detail,message_id=send_once(token,chat,text)
        with closing(db()) as c,c:
            c.execute('UPDATE candidate_messages SET status=?,detail=?,telegram_message_id=?,updated_at=? WHERE request_id=?',(status,detail,message_id,now().isoformat(),str(request_id)))
            return public(c.execute('SELECT * FROM candidate_messages WHERE request_id=?',(str(request_id),)).fetchone())
    app.include_router(router)
