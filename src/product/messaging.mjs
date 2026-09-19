import { randomUUID } from 'node:crypto';

function clone(v){return v==null?v:structuredClone(v);}
function lower(v){return String(v??'').toLowerCase();}

export function createMemoryMessagingStore(){
  const sessions=new Map(); const drafts=new Map(); const schedules=new Map(); const sends=new Map();
  return {
    async saveSession(row){sessions.set(row.id,clone(row));return clone(row);},
    async getSession(id){const row=sessions.get(String(id));return row?clone(row):null;},
    async saveDraft(row){drafts.set(row.id,clone(row));return clone(row);},
    async getDraft(id){const row=drafts.get(String(id));return row?clone(row):null;},
    async saveSchedule(row){schedules.set(row.id,clone(row));return clone(row);},
    async getSchedule(id){const row=schedules.get(String(id));return row?clone(row):null;},
    async listSchedules(sessionId){return [...schedules.values()].filter(r=>r.sessionId===sessionId).map(clone);},
    async saveSend(key,row){sends.set(key,clone(row));return clone(row);},
    async getSend(key){const row=sends.get(String(key));return row?clone(row):null;},
  };
}

export function createFixtureMessagingProvider({name='fixture-messaging',messages=[],token='secret',failSend=null}={}){
  const sent=[]; let revoked=false;
  return {
    name, token,
    revoke(){revoked=true;},
    async search({query=''}){if(revoked){const e=new Error('connector revoked');e.code='REVOKED';throw e;} const q=lower(query); return messages.filter(m=>JSON.stringify(m).toLowerCase().includes(q)).map(clone);},
    async read({conversationId}){if(revoked){const e=new Error('connector revoked');e.code='REVOKED';throw e;} return messages.filter(m=>String(m.conversationId)===String(conversationId)).map(clone);},
    async send(payload){if(revoked){const e=new Error('connector revoked');e.code='REVOKED';throw e;} if(failSend){const e=new Error(failSend.message??'send failed');e.code=failSend.code??'PROVIDER_ERROR';e.retryable=Boolean(failSend.retryable);throw e;} const row={id:'sent-'+(sent.length+1),...clone(payload)};sent.push(row);return clone(row);},
    sent(){return clone(sent);},
  };
}

function summarizeMessages(messages=[]){
  const sorted=[...messages].sort((a,b)=>String(a.timestamp??'').localeCompare(String(b.timestamp??'')));
  const urgent=sorted.filter(m=>/urgent|urgente|asap|hoje|today|deadline/i.test(String(m.text??'')));
  const inbound=sorted.filter(m=>m.direction!=='OUTBOUND');
  const outbound=sorted.filter(m=>m.direction==='OUTBOUND');
  const pendingReply=inbound.length>0 && (!outbound.length || String(inbound.at(-1)?.timestamp??'')>String(outbound.at(-1)?.timestamp??''));
  return {messageCount:sorted.length,urgentCount:urgent.length,pendingReply,lastMessage:clone(sorted.at(-1)??null),actionItems:urgent.map(m=>({messageId:m.id,text:m.text}))};
}

export function createMessagingService({store=createMemoryMessagingStore(),idFactory=randomUUID,now=()=>new Date().toISOString()}={}){
  const adapters=new Map();
  async function requireSession(id,scope){
    const session=await store.getSession(id); if(!session) throw new Error('messaging session not found: '+id);
    if(session.state!=='ACTIVE'){const e=new Error('connector revoked');e.code='REVOKED';throw e;}
    if(scope&&!session.scopes.includes(scope)){const e=new Error('connector scope missing: '+scope);e.code='INSUFFICIENT_SCOPE';e.scope=scope;throw e;}
    const provider=adapters.get(session.id); if(!provider){const e=new Error('connector adapter unavailable');e.code='ADAPTER_UNAVAILABLE';throw e;}
    return {session,provider};
  }
  return {
    async connect({userId,kind,provider,scopes=[],credentialRef=null}){
      if(!userId||!kind||!provider) throw new Error('userId, kind and provider are required');
      const id=idFactory(); const row={id,userId,kind:String(kind).toUpperCase(),provider:provider.name??String(kind).toLowerCase(),scopes:[...new Set(scopes.map(String))],credentialRef:credentialRef?String(credentialRef):null,state:'ACTIVE',createdAt:now(),updatedAt:now()};
      adapters.set(id,provider); await store.saveSession(row); return clone(row);
    },
    async revoke(sessionId){const {session,provider}=await requireSession(sessionId); session.state='REVOKED';session.updatedAt=now();await store.saveSession(session);if(typeof provider.revoke==='function')provider.revoke();return clone(session);},
    async session(sessionId){return store.getSession(sessionId);},
    async search({sessionId,query}){const {provider}=await requireSession(sessionId,'messages.read');return {messages:await provider.search({query}),sessionId};},
    async conversation({sessionId,conversationId}){const {provider}=await requireSession(sessionId,'messages.read');const messages=await provider.read({conversationId});return {conversationId,messages,summary:summarizeMessages(messages)};},
    async draft({sessionId,conversationId,text,replyTo=null}){await requireSession(sessionId,'messages.read');const row={id:idFactory(),sessionId,conversationId:String(conversationId),text:String(text??''),replyTo,createdAt:now()};await store.saveDraft(row);return clone(row);},
    async send({sessionId,conversationId=null,text=null,draftId=null,idempotencyKey}){
      if(!idempotencyKey) throw new Error('idempotencyKey is required'); const prior=await store.getSend(idempotencyKey); if(prior)return {duplicate:true,...clone(prior)};
      const {provider}=await requireSession(sessionId,'messages.send'); let payload={conversationId,text};
      if(draftId){const d=await store.getDraft(draftId);if(!d)throw new Error('draft not found: '+draftId);payload={conversationId:d.conversationId,text:d.text,replyTo:d.replyTo};}
      if(!String(payload.conversationId??'').trim()||!String(payload.text??'').trim())throw new Error('conversationId and text are required');
      const message=await provider.send(payload); const record={sessionId,message:clone(message),sentAt:now()}; await store.saveSend(idempotencyKey,record);return {duplicate:false,...clone(record)};
    },
    async scheduleApproved({sessionId,conversationId,text,sendAt,approvalId,idempotencyKey=null}){
      await requireSession(sessionId,'messages.send'); if(!approvalId)throw new Error('approvalId is required');
      const row={id:idFactory(),sessionId,conversationId:String(conversationId),text:String(text),sendAt:String(sendAt),approvalId:String(approvalId),idempotencyKey:idempotencyKey??null,state:'SCHEDULED',createdAt:now(),updatedAt:now()};
      await store.saveSchedule(row);return clone(row);
    },
    async deliverScheduled(scheduleId,{occurrenceKey}){
      const row=await store.getSchedule(scheduleId);if(!row)throw new Error('scheduled message not found: '+scheduleId);
      if(row.state==='CANCELLED')return {delivered:false,reason:'cancelled'}; if(!occurrenceKey)throw new Error('occurrenceKey is required');
      const key=row.idempotencyKey??`scheduled:${row.id}:${occurrenceKey}`;
      const result=await this.send({sessionId:row.sessionId,conversationId:row.conversationId,text:row.text,idempotencyKey:key});
      row.state='DELIVERED';row.updatedAt=now();await store.saveSchedule(row);return {delivered:true,duplicate:result.duplicate,result};
    },
    async cancelScheduled(id){const row=await store.getSchedule(id);if(!row)throw new Error('scheduled message not found: '+id);if(row.state!=='DELIVERED')row.state='CANCELLED';row.updatedAt=now();await store.saveSchedule(row);return clone(row);},
    async listSchedules(sessionId){return store.listSchedules(sessionId);},
  };
}

export function registerMessagingCapabilities(naia,{service,sessionId,prefix='messaging'}={}){
  if(!naia||typeof naia.registerCapability!=='function')throw new Error('NaIA capability registration is required');
  if(!service||!sessionId)throw new Error('messaging service/sessionId are required');
  return [
    naia.registerCapability({name:`${prefix}.search`,tool:{risk:'SENSITIVE',capability:`${prefix}.read`,description:'Search connected messages',async run(input){return service.search({sessionId,...input});}}}),
    naia.registerCapability({name:`${prefix}.read`,tool:{risk:'SENSITIVE',capability:`${prefix}.read`,description:'Read and summarize a conversation',async run(input){return service.conversation({sessionId,...input});}}}),
    naia.registerCapability({name:`${prefix}.send`,tool:{risk:'EXTERNAL_WRITE',capability:`${prefix}.send`,description:'Send an approved message',async run(input){return service.send({sessionId,...input});}}}),
    naia.registerCapability({name:`${prefix}.schedule`,tool:{risk:'EXTERNAL_WRITE',capability:`${prefix}.send`,description:'Schedule an approved outbound message',async run(input){return service.scheduleApproved({sessionId,...input});}}}),
  ];
}
