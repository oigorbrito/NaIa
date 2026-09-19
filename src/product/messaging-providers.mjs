function clone(v){return v==null?v:structuredClone(v);}
function lower(v){return String(v??'').toLowerCase();}

function httpError(provider,status){
  const e=new Error(provider+' request failed');
  if(status===401){e.code='AUTH_FAILED';e.retryable=false;}
  else if(status===403){e.code='PERMISSION_DENIED';e.retryable=false;}
  else if(status===404){e.code='NOT_FOUND';e.retryable=false;}
  else if(status===429){e.code='RATE_LIMITED';e.retryable=true;}
  else if(status>=500){e.code='PROVIDER_UNAVAILABLE';e.retryable=true;}
  else {e.code='PROVIDER_ERROR';e.retryable=false;}
  e.status=status;
  return e;
}

async function requestJson({provider,url,token,fetchImpl=globalThis.fetch,method='GET',body=null}){
  if(!token)throw new Error(provider+' access token is required');
  if(typeof fetchImpl!=='function')throw new Error('fetch implementation is required');
  const headers={accept:'application/json',authorization:'Bearer '+token};
  if(body!==null)headers['content-type']='application/json; charset=utf-8';
  const response=await fetchImpl(url,{method,headers,body:body===null?undefined:JSON.stringify(body),redirect:'manual'});
  if([301,302,303,307,308].includes(response.status)){const e=new Error(provider+' redirects are not allowed');e.code='REDIRECT_BLOCKED';e.retryable=false;throw e;}
  if(!response.ok)throw httpError(provider,response.status);
  const payload=await response.json();
  if(payload?.ok===false){
    const e=new Error(provider+' API error');
    const code=String(payload.error??'PROVIDER_ERROR').toUpperCase();
    e.code=code==='RATELIMITED'?'RATE_LIMITED':code;
    e.retryable=e.code==='RATE_LIMITED'||e.code==='INTERNAL_ERROR'||e.code==='FATAL_ERROR';
    throw e;
  }
  return payload;
}

function normalizeSlackMessage(message,conversationId=null){
  return {
    id:String(message?.ts??message?.client_msg_id??''),
    conversationId:String(message?.channel_id??message?.channel?.id??conversationId??''),
    direction:'INBOUND',
    text:message?.text??'',
    senderId:message?.user??message?.username??null,
    timestamp:message?.ts??null,
    threadId:message?.thread_ts??null,
    source:'slack',
  };
}

export function createSlackMessagingProvider({accessToken,apiBaseUrl='https://slack.com/api',fetchImpl=globalThis.fetch,maxResults=20}={}){
  const root=String(apiBaseUrl).replace(/\/$/,'');
  let revoked=false;
  function ensureActive(){if(revoked){const e=new Error('connector revoked');e.code='REVOKED';e.retryable=false;throw e;}}
  return {
    name:'slack',
    revoke(){revoked=true;},
    async search({query='' }={}){
      ensureActive();
      const url=new URL(root+'/search.messages');
      url.searchParams.set('query',String(query??''));
      url.searchParams.set('count',String(maxResults));
      const raw=await requestJson({provider:'slack',url,token:accessToken,fetchImpl});
      return (raw?.messages?.matches??[]).map((m)=>normalizeSlackMessage(m,m?.channel?.id??null));
    },
    async read({conversationId}){
      ensureActive();
      const url=new URL(root+'/conversations.history');
      url.searchParams.set('channel',String(conversationId));
      url.searchParams.set('limit',String(Math.min(maxResults,15)));
      const raw=await requestJson({provider:'slack',url,token:accessToken,fetchImpl});
      return (raw?.messages??[]).map((m)=>normalizeSlackMessage(m,conversationId));
    },
    async send({conversationId,text,replyTo=null}){
      ensureActive();
      const raw=await requestJson({
        provider:'slack',
        url:root+'/chat.postMessage',
        token:accessToken,
        fetchImpl,
        method:'POST',
        body:{channel:String(conversationId),text:String(text),...(replyTo?{thread_ts:String(replyTo)}:{})},
      });
      return {
        id:String(raw?.ts??''),
        conversationId:String(raw?.channel??conversationId),
        direction:'OUTBOUND',
        text:String(raw?.message?.text??text),
        senderId:raw?.message?.bot_id??raw?.message?.user??null,
        timestamp:raw?.ts??null,
        threadId:raw?.message?.thread_ts??replyTo??null,
        source:'slack',
      };
    },
  };
}

export function createMemoryWhatsAppWebhookStore(){
  const messages=[];
  const ids=new Set();
  return {
    async append(rows){
      let added=0;
      for(const row of rows??[]){
        const id=String(row?.id??'');
        if(!id||ids.has(id))continue;
        ids.add(id);messages.push(clone(row));added+=1;
      }
      return added;
    },
    async list(){return messages.map(clone);},
  };
}

function normalizeWhatsAppInbound(message,{phoneNumberId=null}={}){
  const from=String(message?.from??'');
  return {
    id:String(message?.id??''),
    conversationId:from,
    direction:'INBOUND',
    text:message?.text?.body??message?.button?.text??message?.interactive?.button_reply?.title??message?.interactive?.list_reply?.title??'',
    senderId:from||null,
    timestamp:message?.timestamp?new Date(Number(message.timestamp)*1000).toISOString():null,
    phoneNumberId:phoneNumberId??null,
    source:'whatsapp',
  };
}

export function parseWhatsAppWebhook(payload){
  const rows=[];
  for(const entry of payload?.entry??[]){
    for(const change of entry?.changes??[]){
      const value=change?.value??{};
      const phoneNumberId=value?.metadata?.phone_number_id??null;
      for(const message of value?.messages??[]){
        const normalized=normalizeWhatsAppInbound(message,{phoneNumberId});
        if(normalized.id)rows.push(normalized);
      }
    }
  }
  return rows;
}

export function createWhatsAppCloudMessagingProvider({
  accessToken,
  phoneNumberId,
  apiVersion='v23.0',
  graphBaseUrl='https://graph.facebook.com',
  fetchImpl=globalThis.fetch,
  webhookStore=createMemoryWhatsAppWebhookStore(),
}={}){
  if(!phoneNumberId)throw new Error('WhatsApp phoneNumberId is required');
  const root=String(graphBaseUrl).replace(/\/$/,'');
  let revoked=false;
  function ensureActive(){if(revoked){const e=new Error('connector revoked');e.code='REVOKED';e.retryable=false;throw e;}}
  return {
    name:'whatsapp',
    revoke(){revoked=true;},
    async ingestWebhook(payload){
      ensureActive();
      const rows=parseWhatsAppWebhook(payload);
      const added=await webhookStore.append(rows);
      return {received:rows.length,added};
    },
    async search({query='' }={}){
      ensureActive();
      const q=lower(query);
      return (await webhookStore.list()).filter((m)=>!q||JSON.stringify(m).toLowerCase().includes(q));
    },
    async read({conversationId}){
      ensureActive();
      return (await webhookStore.list()).filter((m)=>String(m.conversationId)===String(conversationId));
    },
    async send({conversationId,text,replyTo=null}){
      ensureActive();
      const body={
        messaging_product:'whatsapp',
        to:String(conversationId),
        type:'text',
        text:{body:String(text)},
        ...(replyTo?{context:{message_id:String(replyTo)}}:{}),
      };
      const raw=await requestJson({
        provider:'whatsapp',
        url:root+'/'+apiVersion+'/'+encodeURIComponent(String(phoneNumberId))+'/messages',
        token:accessToken,
        fetchImpl,
        method:'POST',
        body,
      });
      const id=raw?.messages?.[0]?.id??null;
      return {
        id:id?String(id):'',
        conversationId:String(conversationId),
        direction:'OUTBOUND',
        text:String(text),
        senderId:String(phoneNumberId),
        timestamp:null,
        replyTo:replyTo??null,
        source:'whatsapp',
      };
    },
  };
}
