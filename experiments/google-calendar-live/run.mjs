import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFilePorts } from '../../src/product/file-ports.mjs';
import { registerProductCapabilities } from '../../src/product/capabilities.mjs';
import { createGoogleCalendarProvider } from '../../src/product/google-calendar.mjs';
import { createNaiaService } from '../../src/product/service.mjs';

function required(value,name){const text=String(value??'').trim();if(!text)throw new Error(`${name} is required`);return text;}
function commitId(){
  const explicit=String(process.env.NAIA_VALIDATION_COMMIT??process.env.GITHUB_SHA??'').trim();if(explicit)return explicit;
  try{return execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();}catch{return 'UNKNOWN';}
}
function defaultRange(){const from=new Date();const to=new Date(from.getTime()+24*60*60*1000);return {from:from.toISOString(),to:to.toISOString()};}
async function persistedText(rootDir){const names=['objectives.json','plans.json','evidence.jsonl'];const chunks=[];for(const name of names){try{chunks.push(await readFile(join(rootDir,name),'utf8'));}catch(error){if(error?.code!=='ENOENT')throw error;}}return chunks.join('\n');}
async function writeReceipt(path,receipt){await mkdir(dirname(path),{recursive:true});await writeFile(path,`${JSON.stringify(receipt,null,2)}\n`,'utf8');}

const token=required(process.env.NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN,'NAIA_GOOGLE_CALENDAR_ACCESS_TOKEN');
const defaults=defaultRange();
const from=process.env.NAIA_GOOGLE_CALENDAR_LIVE_FROM||defaults.from;
const to=process.env.NAIA_GOOGLE_CALENDAR_LIVE_TO||defaults.to;
const outputPath=process.env.NAIA_GOOGLE_CALENDAR_LIVE_RECEIPT||'.reproduction/google-calendar-live.json';
const keep=process.env.NAIA_GOOGLE_CALENDAR_LIVE_KEEP==='1';
const rootDir=await mkdtemp(join(tmpdir(),'naia-gcal-live-'));
const baseReceipt={gate:'LIVE_GCAL_READ',commit:commitId(),from,to};

try{
  const ports=createFilePorts({rootDir});
  const calendar=createGoogleCalendarProvider({
    accessToken:token,calendarId:process.env.NAIA_GOOGLE_CALENDAR_ID??'primary',
    apiBaseUrl:process.env.NAIA_GOOGLE_CALENDAR_API_BASE_URL??'https://www.googleapis.com',
    timeoutMs:Number(process.env.NAIA_GOOGLE_CALENDAR_TIMEOUT_MS??5000),
    maxBytes:Number(process.env.NAIA_GOOGLE_CALENDAR_MAX_BYTES??262144),
  });
  registerProductCapabilities({registry:ports.tools,calendar});
  const naia=createNaiaService(ports);
  const result=await naia.pursueAction({title:'Live Google Calendar read validation',intent:'LIVE_GCAL_READ',action:{tool:'calendar.list',input:{from,to},risk:'READ_ONLY',requiresApproval:false}});
  if(result.objective.status!=='COMPLETED')throw new Error(`live Google Calendar objective ended as ${result.objective.status}`);
  const evidence=await ports.evidence.list({objectiveId:result.objective.id});
  const execution=evidence.find((row)=>row.type==='STEP_EXECUTED'&&row.tool==='calendar.list');
  if(!execution?.ok)throw new Error('successful calendar.list evidence missing');
  const stored=await persistedText(rootDir);
  if(stored.includes(token))throw new Error('Google Calendar access token leaked into persisted state');
  const events=execution.output?.result?.events;
  const receipt={...baseReceipt,status:'PASS',provider:'google-calendar',eventCount:Array.isArray(events)?events.length:null,objectiveId:result.objective.id};
  if(JSON.stringify(receipt).includes(token))throw new Error('Google Calendar access token leaked into receipt');
  await writeReceipt(outputPath,receipt);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}catch(error){
  const receipt={...baseReceipt,status:'FAIL',error:{code:error?.code??'LIVE_GCAL_FAILED',message:error?.message??String(error),retryable:Boolean(error?.retryable)}};
  await writeReceipt(outputPath,receipt);
  process.stderr.write(`${JSON.stringify(receipt)}\n`);
  process.exitCode=1;
}finally{if(!keep)await rm(rootDir,{recursive:true,force:true});}
