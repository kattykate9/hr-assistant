import { PGlite } from '@electric-sql/pglite';
import readline from 'node:readline';
const db = new PGlite();
await db.waitReady;
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
for await (const line of rl) {
 try {
  const {sql,args}=JSON.parse(line);
  const result=args===null?await db.exec(sql):[await db.query(sql,args)];
  process.stdout.write(JSON.stringify({rows:result.at(-1)?.rows??[]})+'\n');
 }catch(e){process.stdout.write(JSON.stringify({error:e.message})+'\n');}
}
await db.close();
