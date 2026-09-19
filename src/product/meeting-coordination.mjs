import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function clone(v){ return v==null?v:structuredClone(v); }
function fp(v){ return createHash('sha256').update(JSON.stringify(v)).digest('hex'); }

export function normalizeMeetingIntent(input={}){
  const duration=Number(input.durationMinutes??30);
  if(!Number.isFinite(duration)||duration<=0) throw new Error('meeting duration must be positive');
  return {
    title:String(input.title??'Meeting').trim()||'Meeting',
    participants:[...new Set((input.participants??[]).map(String).map((v)=>v.trim()).filter(Boolean))],
    durationMinutes:duration,
    timezone:String(input.timezone??'UTC'),
    date:input.date??null,
    timeWindow:clone(input.timeWindow??null),
    location:input.location??null,
    constraints:clone(input.constraints??{}),
  };
}

export function createMemoryMeetingStore(){
  const meetings=new Map(), actions=new Map(), commits=new Map(), notifications=[];
  return {
    async saveMeeting(row){ meetings.set(row.id,clone(row)); return clone(row); },
    async getMeeting(id){ const row=meetings.get(id); return row?clone(row):null; },
    async saveAction(row){ actions.set(row.id,clone(row)); return clone(row); },
    async getAction(id){ const row=actions.get(id); return row?clone(row):null; },
    async saveCommit(key,row){ commits.set(key,clone(row)); return clone(row); },
    async getCommit(key){ const row=commits.get(key); return row?clone(row):null; },
    async appendNotification(row){ notifications.push(clone(row)); return clone(row); },
    async listNotifications(meetingId){ return notifications.filter((row)=>row.meetingId===meetingId).map(clone); },
  };
}

async function readMeetingJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {meetings:{},actions:{},commits:{},notifications:[]};throw error;}}
async function writeMeetingJsonAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileMeetingStore({rootDir='.naia'}={}){
  const path=join(rootDir,'meetings.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readMeetingJson(path);const result=await fn(data);await writeMeetingJsonAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async saveMeeting(row){return mutate(data=>{data.meetings[row.id]=clone(row);return row;});},
    async getMeeting(id){const data=await readMeetingJson(path);return data.meetings?.[String(id)]?clone(data.meetings[String(id)]):null;},
    async saveAction(row){return mutate(data=>{data.actions[row.id]=clone(row);return row;});},
    async getAction(id){const data=await readMeetingJson(path);return data.actions?.[String(id)]?clone(data.actions[String(id)]):null;},
    async saveCommit(key,row){return mutate(data=>{data.commits[key]=clone(row);return row;});},
    async getCommit(key){const data=await readMeetingJson(path);return data.commits?.[String(key)]?clone(data.commits[String(key)]):null;},
    async appendNotification(row){return mutate(data=>{data.notifications.push(clone(row));return row;});},
    async listNotifications(meetingId){const data=await readMeetingJson(path);return (data.notifications??[]).filter(row=>row.meetingId===meetingId).map(clone);},
  };
}

export function createFixtureMeetingProvider({name='calendar-provider',slots=[],failCommit=null}={}){
  const options=new Map(slots.map((slot)=>[String(slot.id),clone(slot)]));
  const events=new Map(); const notifyKeys=new Set();
  return {
    name,
    async availability(){ return [...options.values()].filter((s)=>s.available!==false).map(clone); },
    async create({intent,optionId,expectedOptionRevision,idempotencyKey}){
      if(failCommit){ const e=new Error(failCommit.message??'provider failed'); e.code=failCommit.code??'PROVIDER_ERROR'; e.retryable=Boolean(failCommit.retryable); throw e; }
      const existing=[...events.values()].find((e)=>e.idempotencyKey===idempotencyKey&&e.operation==='CREATE'); if(existing) return clone(existing.result);
      const option=options.get(String(optionId)); if(!option||option.available===false){ const e=new Error('slot unavailable'); e.code='SLOT_UNAVAILABLE'; throw e; }
      if(String(option.revision??'1')!==String(expectedOptionRevision)){ const e=new Error('slot changed'); e.code='SLOT_CHANGED'; e.currentRevision=String(option.revision??'1'); throw e; }
      const eventId='event-'+(events.size+1);
      const result={eventId,title:intent.title,participants:clone(intent.participants),start:option.start,end:option.end,timezone:option.timezone??intent.timezone,location:option.location??intent.location,revision:'1'};
      events.set(eventId,{operation:'CREATE',idempotencyKey,result:clone(result),state:'CONFIRMED'}); return result;
    },
    async mutate({eventId,type,expectedRevision,targetOptionId=null,expectedTargetRevision=null,idempotencyKey}){
      const prior=[...events.values()].find((e)=>e.idempotencyKey===idempotencyKey&&e.operation===type); if(prior) return clone(prior.result);
      const current=events.get(eventId); if(!current){ const e=new Error('event not found'); e.code='NOT_FOUND'; throw e; }
      if(String(current.result.revision)!==String(expectedRevision)){ const e=new Error('event changed'); e.code='EVENT_CHANGED'; throw e; }
      if(type==='CANCEL'){ current.state='CANCELLED'; current.operation='CANCEL'; current.idempotencyKey=idempotencyKey; current.result={...current.result,cancelled:true,revision:String(Number(current.result.revision)+1)}; events.set(eventId,current); return clone(current.result); }
      if(type==='RESCHEDULE'){
        const option=options.get(String(targetOptionId)); if(!option||option.available===false){ const e=new Error('slot unavailable'); e.code='SLOT_UNAVAILABLE'; throw e; }
        if(String(option.revision??'1')!==String(expectedTargetRevision)){ const e=new Error('slot changed'); e.code='SLOT_CHANGED'; throw e; }
        current.operation='RESCHEDULE'; current.idempotencyKey=idempotencyKey; current.result={...current.result,start:option.start,end:option.end,timezone:option.timezone??current.result.timezone,location:option.location??current.result.location,revision:String(Number(current.result.revision)+1)}; events.set(eventId,current); return clone(current.result);
      }
      throw new Error('unsupported meeting mutation: '+type);
    },
    async notify({eventId,type,participants,idempotencyKey}){
      if(notifyKeys.has(idempotencyKey)) return {duplicate:true,eventId,type};
      notifyKeys.add(idempotencyKey); return {duplicate:false,eventId,type,participants:clone(participants),provider:name};
    },
    setSlotRevision(id,revision){ const row=options.get(String(id)); if(row) row.revision=String(revision); },
    setSlotAvailable(id,available){ const row=options.get(String(id)); if(row) row.available=Boolean(available); },
  };
}

export function createMeetingService({store=createMemoryMeetingStore(),providers=[],idFactory=randomUUID,now=()=>new Date().toISOString()}={}){
  const providerMap=new Map(providers.map((p)=>[p.name,p]));
  async function requireAction(id){ const row=await store.getAction(id); if(!row) throw new Error('meeting action not found: '+id); return row; }
  return {
    async discover(intentInput){
      const intent=normalizeMeetingIntent(intentInput); const options=[];
      for(const provider of providers){ for(const slot of await provider.availability({intent:clone(intent)})){ options.push({provider:provider.name,optionId:String(slot.id),start:slot.start,end:slot.end,timezone:slot.timezone??intent.timezone,location:slot.location??intent.location,revision:String(slot.revision??'1'),observedAt:now()}); } }
      return {intent,options};
    },
    async prepareCreate({userId,intent,option}){
      if(!providerMap.has(option?.provider)) throw new Error('meeting provider not registered');
      const payload={type:'CREATE',userId,intent:normalizeMeetingIntent(intent),option:clone(option)};
      const row={id:idFactory(),userId,type:'CREATE',status:'PREPARED',fingerprint:fp(payload),payload,createdAt:now(),updatedAt:now()}; await store.saveAction(row); return clone(row);
    },
    async prepareMutation({userId,meetingId,type,targetOption=null}){
      if(!['CANCEL','RESCHEDULE'].includes(type)) throw new Error('unsupported meeting mutation');
      const meeting=await store.getMeeting(meetingId); if(!meeting) throw new Error('meeting not found: '+meetingId);
      const payload={type,userId,meetingId,provider:meeting.provider,eventId:meeting.eventId,expectedRevision:meeting.revision,targetOption:clone(targetOption)};
      const row={id:idFactory(),userId,type,status:'PREPARED',fingerprint:fp(payload),payload,createdAt:now(),updatedAt:now()}; await store.saveAction(row); return clone(row);
    },
    async commit({actionId,fingerprint,idempotencyKey}){
      const action=await requireAction(actionId); if(action.fingerprint!==fingerprint){ const e=new Error('meeting action fingerprint mismatch'); e.code='ACTION_STALE'; throw e; }
      const prior=await store.getCommit(idempotencyKey); if(prior) return {duplicate:true,...clone(prior)};
      if(action.status!=='APPROVED'){ const e=new Error('meeting action requires runtime approval'); e.code='APPROVAL_REQUIRED'; throw e; }
      const p=action.payload; const provider=providerMap.get(p.type==='CREATE'?p.option.provider:p.provider); if(!provider) throw new Error('meeting provider not registered');
      try{
        let result,meeting;
        if(p.type==='CREATE'){
          result=await provider.create({intent:p.intent,optionId:p.option.optionId,expectedOptionRevision:p.option.revision,idempotencyKey});
          meeting={id:idFactory(),userId:action.userId,provider:p.option.provider,eventId:result.eventId,state:'CONFIRMED',title:result.title,participants:clone(result.participants),start:result.start,end:result.end,timezone:result.timezone,location:result.location,revision:String(result.revision??'1'),createdAt:now(),updatedAt:now()};
        }else{
          result=await provider.mutate({eventId:p.eventId,type:p.type,expectedRevision:p.expectedRevision,targetOptionId:p.targetOption?.optionId??null,expectedTargetRevision:p.targetOption?.revision??null,idempotencyKey});
          meeting=await store.getMeeting(p.meetingId); meeting.state=p.type==='CANCEL'?'CANCELLED':'CONFIRMED'; meeting.start=result.start; meeting.end=result.end; meeting.timezone=result.timezone; meeting.location=result.location; meeting.revision=String(result.revision??meeting.revision); meeting.updatedAt=now();
        }
        await store.saveMeeting(meeting); action.status='COMPLETED'; action.updatedAt=now(); await store.saveAction(action);
        const notification=await provider.notify({eventId:meeting.eventId,type:p.type,participants:meeting.participants,idempotencyKey:idempotencyKey+':notify'});
        await store.appendNotification({meetingId:meeting.id,actionId:action.id,type:p.type,outcome:clone(notification),at:now()});
        const commit={actionId:action.id,meeting:clone(meeting),notification:clone(notification),committedAt:now()}; await store.saveCommit(idempotencyKey,commit); return {duplicate:false,...clone(commit)};
      }catch(error){
        if(['SLOT_CHANGED','SLOT_UNAVAILABLE','EVENT_CHANGED'].includes(error?.code)) action.status='WAITING_REVIEW'; else action.status='FAILED'; action.updatedAt=now(); await store.saveAction(action); throw error;
      }
    },
    async executeRuntimeApproved({actionId,fingerprint,idempotencyKey}){
      const action=await requireAction(actionId);
      if(action.fingerprint!==fingerprint){const e=new Error('meeting action fingerprint mismatch');e.code='ACTION_STALE';throw e;}
      if(action.status==='WAITING_REVIEW'){const e=new Error('meeting action requires renewed review');e.code='APPROVAL_REQUIRED';throw e;}
      if(action.status!=='APPROVED'){action.status='APPROVED';action.updatedAt=now();await store.saveAction(action);}
      return this.commit({actionId,fingerprint,idempotencyKey});
    },

    async getAction(id){ return requireAction(id); },
    async getMeeting(id){ return store.getMeeting(id); },
    async notifications(id){ return store.listNotifications(id); },
  };
}

export function registerMeetingCapability(naia,{service}){
  if(!naia||typeof naia.registerCapability!=='function') throw new Error('NaIA capability registration is required');
  return naia.registerCapability({name:'meeting.commit',tool:{risk:'EXTERNAL_WRITE',capability:'calendar',description:'Commits one prepared meeting create/reschedule/cancel mutation',async run(input){ return service.executeRuntimeApproved(input); }}});
}

export async function proposeMeetingAction(naia,action){
  if(!naia||typeof naia.pursueAction!=='function') throw new Error('NaIA pursueAction is required');
  const p=action.payload;
  const summary=p.type==='CREATE'?{type:p.type,provider:p.option.provider,start:p.option.start,end:p.option.end,timezone:p.option.timezone,participants:p.intent.participants}:{type:p.type,meetingId:p.meetingId,targetOption:p.targetOption??null};
  const confirmationId=`meeting:${action.id}:${action.fingerprint}`;
  return naia.pursueAction({
    id:`meeting-objective:${action.id}`,title:`Meeting ${p.type.toLowerCase()}`,intent:'MEETING_COORDINATION',
    confirmation:{required:true,id:confirmationId,payload:summary},
    action:{tool:'meeting.commit',input:{actionId:action.id,fingerprint:action.fingerprint,idempotencyKey:`meeting:${action.id}`},risk:'EXTERNAL_WRITE',requiresApproval:true},
  });
}
