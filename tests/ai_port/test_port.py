import os,sys,unittest,json,uuid,threading
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[2] / 'back'))
from pgbridge import PG
os.environ.update(BOT_API_KEY='test-bot',WEB_API_KEY='x'*40,OPENAI_API_KEY='test-only')
from fastapi import FastAPI,HTTPException
from fastapi.testclient import TestClient
from psycopg.types.json import Jsonb
import db,candidate_ai as ai,ai_jd
from job_descriptions import install_jd,JDDraftRequest
from candidate_workflow import install_candidate_workflow
from recruitment_views import install_recruitment_views
from company_settings import init_company_settings
import security

class PortTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls): cls.pg=PG()
 @classmethod
 def tearDownClass(cls): cls.pg.close()
 def setUp(self):
  self.pg.execute('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
  with self.pg.connection() as c: db.init_db(c);db.init_db(c);init_company_settings(c)
  self.pg.execute("INSERT INTO vacancies(id,title,direction,description,criteria,preferred_criteria,created_at) VALUES (1,'Маркетинг-инженер','traffic','Рекламные кампании',$1,$2,now())", [json.dumps(['Python','SQL']),json.dumps([])])
  self.pg.execute("INSERT INTO applications(id,vacancy_id,name,contact,source,resume_text,status,created_at) VALUES(1,1,'Тест','test@example.com','manual','Использую Python. Изучаю SQL.','new',now())")
  app=FastAPI();security.install_security(app);install_jd(app,self.pg.connection);install_candidate_workflow(app,self.pg.connection);install_recruitment_views(app,self.pg.connection)
  self.guard=patch.object(security,'session_user',lambda req: 'tester' if req.headers.get('authorization')=='Bearer valid-test-session' else None);self.guard.start()
  self.client=TestClient(app)
  self.headers={'Authorization':'Bearer valid-test-session','X-HR-Action':'candidate-workflow'}
 def tearDown(self): self.guard.stop()
 def get(self,path): return self.client.get(path,headers=self.headers)
 def run_ai(self,rid=None,fp=None):
  fp=fp or self.get('/recruiting/applications/1/ai-assessment').json()['fingerprint']
  return self.client.post('/recruiting/applications/1/ai-assessment',headers=self.headers,json={'request_id':rid or str(uuid.uuid4()),'fingerprint':fp,'share_with_openai':True})
 def review(self,data,*_):
  return ai.validate_review({'facts':[{'category':'skills','text':'Использует Python','evidence':'Использую Python.'}], 'answers':[
   {'key':'required:0','rating':'confirmed','evidence':'Использую Python.','explanation':'Указано в резюме','question':''},
   {'key':'required:1','rating':'partial','evidence':'Изучаю SQL.','explanation':'Только обучение','question':'Какой опыт SQL?'}]},data)
 def test_duplicate_stale_card_list_and_no_manual_mutation(self):
  rid=str(uuid.uuid4())
  with patch.object(ai,'request_review',side_effect=self.review) as provider:
   result=self.run_ai(rid);self.assertEqual(result.status_code,200,result.text);self.assertEqual(result.json()['result']['percent'],75)
   self.assertEqual(self.run_ai(rid).status_code,200)
   self.assertEqual(self.run_ai().status_code,200)
   self.assertEqual(provider.call_count,1)
  card=self.get('/recruiting/applications/1').json();self.assertEqual(card['ai_assessment']['result']['percent'],75)
  self.assertEqual(card['application']['status'],'new');self.assertEqual(card['assessment']['version'],0)
  listing=self.get('/recruiting/applications');self.assertEqual(listing.status_code,200,listing.text)
  self.assertEqual(listing.json()['items'][0]['ai_match']['percent'],75)
  self.pg.execute("UPDATE vacancies SET description='Новые задачи' WHERE id=1")
  self.assertTrue(self.get('/recruiting/applications/1/ai-assessment').json()['stale'])
  self.assertIsNone(self.get('/recruiting/applications').json()['items'][0]['ai_match']['percent'])
 def test_auth_consent_invalid_fingerprint_no_payment(self):
  with patch.object(ai,'request_review') as provider:
   self.assertEqual(self.client.get('/recruiting/applications/1/ai-assessment').status_code,401)
   self.assertEqual(self.client.get('/recruiting/applications/1/ai-assessment',headers={'X-Bot-Key':'test-bot'}).status_code,403)
   self.assertEqual(self.run_ai(fp='0'*64).status_code,409)
   r=self.client.post('/recruiting/applications/1/ai-assessment',headers=self.headers,json={'request_id':str(uuid.uuid4()),'fingerprint':'0'*64})
   self.assertEqual(r.status_code,422);provider.assert_not_called()
 def test_failure_is_saved_no_automatic_retry(self):
  rid=str(uuid.uuid4())
  with patch.object(ai,'request_review',side_effect=HTTPException(504,'Timeout')) as provider:
   self.assertEqual(self.run_ai(rid).status_code,504)
   self.assertEqual(self.run_ai(rid).json()['run']['status'],'failed')
   self.assertEqual(provider.call_count,1)
 def test_change_during_analysis_and_lock(self):
  def changing(data,*args):
   self.pg.execute("UPDATE applications SET resume_text='Новое резюме' WHERE id=1")
   self.assertEqual(self.run_ai().status_code,409)
   return self.review(data)
  with patch.object(ai,'request_review',side_effect=changing): self.assertTrue(self.run_ai().json()['stale'])
 def test_jd_jsonb_legacy_preservation_approval(self):
  payload={'title':'Маркетинг-инженер','direction':'traffic','content':'Описание роли и задач маркетинг-инженера','internal_notes':'Внутренний комментарий','template_inputs':{'purpose':'Привлечение клиентов','tasks':'Вести кампании'}}
  r=self.client.post('/job-descriptions',headers=self.headers,json=payload);self.assertEqual(r.status_code,201,r.text);jd=r.json()
  self.assertEqual(jd['template_inputs']['purpose'],'Привлечение клиентов')
  legacy={k:payload[k] for k in ['title','direction','content']};legacy.update(version=1,approve=True)
  r=self.client.put(f"/job-descriptions/{jd['id']}",headers=self.headers,json=legacy);self.assertEqual(r.status_code,200,r.text)
  self.assertEqual(r.json()['internal_notes'],payload['internal_notes']);self.assertEqual(r.json()['template_inputs'],jd['template_inputs'])
  legacy['version']=2;self.assertEqual(self.client.put(f"/job-descriptions/{jd['id']}",headers=self.headers,json=legacy).status_code,409)
 def test_quotes_and_percentage(self):
  with self.pg.connection() as c: data=ai.snapshot(c,1)[0]
  result=self.review(data);self.assertEqual(result['percent'],75)
  raw={'facts':[],'answers':[{k:v for k,v in a.items() if k not in ['criterion','kind']} for a in result['answers']]}
  raw['answers'][0]['evidence']='Придуманная цитата'
  with self.assertRaises(ValueError):ai.validate_review(raw,data)
  for answer in raw['answers']:answer.update(rating='not_confirmed',evidence='')
  self.assertEqual(ai.validate_review(raw,data)['percent'],0)
  for answer in raw['answers']:answer['rating']='not_applicable'
  self.assertIsNone(ai.validate_review(raw,data)['percent'])
 def test_jd_generation_no_save_and_blank_fields(self):
  payload={'title':'Маркетинг-инженер','direction':'traffic','inputs':{'purpose':'Привлекать клиентов','tasks':'Вести кампании'},'share_with_openai':True}
  request=JDDraftRequest(**payload)
  raw={k:'Лишние придуманные сведения' for k in ai_jd.SECTIONS};raw['questions']=[]
  result=ai_jd.validate_draft(raw,request)
  self.assertIn('Условия:\nТребует уточнения',result['content'])
  with patch('job_descriptions.generate_jd_draft',return_value=result):
   r=self.client.post('/job-descriptions/ai-draft',headers=self.headers,json=payload);self.assertEqual(r.status_code,200,r.text)
  self.assertEqual(self.get('/job-descriptions').json(),[])

 def test_provider_payload_and_malformed_output(self):
  import httpx
  client_class=httpx.Client
  sent=[]
  with self.pg.connection() as c:data=ai.snapshot(c,1)[0]
  result=self.review(data)
  raw={'facts':result['facts'],'answers':[{k:v for k,v in a.items() if k not in ['criterion','kind']} for a in result['answers']]}
  def respond(request):
   payload=json.loads(request.content);sent.append(payload)
   output=raw if payload['text']['format']['name']=='resume_review' else {**{k:'' for k in ai_jd.SECTIONS},'questions':[]}
   return httpx.Response(200,json={'status':'completed','output':[{'content':[{'type':'output_text','text':json.dumps(output)}]}]})
  def factory(**kwargs):return client_class(transport=httpx.MockTransport(respond),**kwargs)
  with patch.object(httpx,'Client',side_effect=factory):
   self.assertEqual(ai.request_review(data,'test-only','gpt-4.1-mini')['percent'],75)
   ai_jd._last_attempt=0
   ai_jd.generate_jd_draft(JDDraftRequest(title='Маркетинг-инженер',direction='traffic',inputs={'purpose':'Цель','tasks':'Задачи'},share_with_openai=True))
  self.assertEqual(len(sent),2)
  for payload in sent:
   self.assertIs(payload['store'],False);self.assertTrue(payload['text']['format']['strict'])
   self.assertNotIn('tools',payload);self.assertNotIn('test@example.com',payload['input'])
   self.assertNotIn('internal_notes',payload['input'])
  def invalid(request):return httpx.Response(200,json={'status':'incomplete'})
  with patch.object(httpx,'Client',side_effect=lambda **kw:client_class(transport=httpx.MockTransport(invalid),**kw)):
   with self.assertRaises(HTTPException) as caught:ai.request_review(data,'test-only','gpt-4.1-mini')
   self.assertEqual(caught.exception.status_code,502)

if __name__=='__main__':unittest.main()
