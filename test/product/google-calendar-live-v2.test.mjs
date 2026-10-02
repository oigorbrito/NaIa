import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

async function withServer(handler,fn){const server=http.createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening');const a=server.address();try{await fn(`http://127.0.0.1:${a.port}`);}finally{server.close();await once(server,'close');}}

test('live harness exercises current NaIA stack, writes commit-bound PASS receipt, and redacts token',async()=>{
  const token='fixture-live-token';let auth=null;let requestUrl=null;
  const dir=await mkdtemp(join(tmpdir(),'naia-gcal-receipt-'));const receiptPath=join(dir,'receipt.json');
  try{
    await withServer((req,res)=>{auth=req.headers.authorization??null;requestUrl=req.url;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({items:[{id:'e1',summary:'Fixture',start:{dateTime:'2026-09-20T10:00:00Z'},end:{dateTime:'2026-09-20T11:00:00Z'}}]}));},async(base)=>{
      const { stdout: stdoutText, stderr: stderrText } = await execFileAsync(process.execPath,['experiments/google-calendar-live/run.mjs'],{cwd:process.cwd(),env:{...process.env,NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN:token,NAIA_GOOGLE_CALENDAR_API_BASE_URL:base,NAIA_GOOGLE_CALENDAR_LIVE_FROM:'2026-09-20T00:00:00Z',NAIA_GOOGLE_CALENDAR_LIVE_TO:'2026-09-21T00:00:00Z',NAIA_GOOGLE_CALENDAR_LIVE_RECEIPT:receiptPath,NAIA_VALIDATION_COMMIT:'fixture-commit'},encoding:'utf8'});
      const stdout=JSON.parse(stdoutText.trim());const receipt=JSON.parse(await readFile(receiptPath,'utf8'));
      assert.equal(stdout.status,'PASS');assert.equal(receipt.status,'PASS');assert.equal(receipt.gate,'LIVE_GCAL_READ');assert.equal(receipt.commit,'fixture-commit');assert.equal(receipt.eventCount,1);
      assert.equal(auth,`Bearer ${token}`);assert.match(requestUrl,/timeMin=2026-09-20T00%3A00%3A00Z/);
      assert.equal(stdoutText.includes(token),false);assert.equal(stderrText.includes(token),false);assert.equal(JSON.stringify(receipt).includes(token),false);
    });
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('live harness writes FAIL receipt for invalid/expired credentials without leaking token',async()=>{
  const token='expired-secret';const dir=await mkdtemp(join(tmpdir(),'naia-gcal-fail-'));const receiptPath=join(dir,'receipt.json');
  try{
    await withServer((req,res)=>{res.writeHead(401,{'content-type':'application/json'});res.end('{}');},async(base)=>{
      let err=null;
      try{
        await execFileAsync(process.execPath,['experiments/google-calendar-live/run.mjs'],{cwd:process.cwd(),env:{...process.env,NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN:token,NAIA_GOOGLE_CALENDAR_API_BASE_URL:base,NAIA_GOOGLE_CALENDAR_LIVE_RECEIPT:receiptPath,NAIA_VALIDATION_COMMIT:'fixture-commit'},encoding:'utf8'});
      }catch(e){err=e;}
      assert.ok(err);
      const receipt=JSON.parse(await readFile(receiptPath,'utf8'));
      assert.equal(receipt.status,'FAIL');assert.equal(receipt.error.code,'LIVE_GCAL_FAILED');
      assert.equal((err.stdout??'').includes(token),false);assert.equal((err.stderr??'').includes(token),false);assert.equal(JSON.stringify(receipt).includes(token),false);
    });
  }finally{await rm(dir,{recursive:true,force:true});}
});
