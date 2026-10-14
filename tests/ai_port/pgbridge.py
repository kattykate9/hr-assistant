import subprocess,json,threading
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime
from psycopg.types.json import Jsonb

class Rows:
 def __init__(self,rows): self.rows=rows;self.rowcount=len(rows)
 def fetchone(self): return self.rows[0] if self.rows else None
 def fetchall(self): return self.rows
 def __iter__(self): return iter(self.rows)
class PG:
 def __init__(self):
  self.proc=subprocess.Popen(['node',str(Path(__file__).with_name('bridge.mjs'))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
  self.lock=threading.RLock()
 def execute(self,sql,args=None):
  if args is not None:
   # Existing SQL uses positional %s placeholders; no substitutions within user data.
   parts=sql.split('%s');sql=''.join(part+(f'${i+1}' if i<len(parts)-1 else '') for i,part in enumerate(parts))
  def encode(v):
   if isinstance(v,Jsonb): return v.obj
   if isinstance(v,datetime): return v.isoformat()
   raise TypeError(type(v).__name__)
  with self.lock:
   self.proc.stdin.write(json.dumps({'sql':sql,'args':args},default=encode)+'\n');self.proc.stdin.flush()
   line=self.proc.stdout.readline()
   if not line: raise RuntimeError('PGlite bridge closed')
   data=json.loads(line)
   if 'error' in data: raise RuntimeError(data['error']+' SQL: '+sql)
   return Rows(data['rows'])
 @contextmanager
 def connection(self):
  with self.lock:
   self.execute('BEGIN')
   try: yield self
   except BaseException: self.execute('ROLLBACK');raise
   else: self.execute('COMMIT')
 def close(self): self.proc.stdin.close();self.proc.wait(timeout=10);self.proc.stdout.close()
