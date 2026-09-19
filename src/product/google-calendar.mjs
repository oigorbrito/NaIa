function normalizeBaseUrl(value){
  let url;
  try{url=new URL(String(value??'https://www.googleapis.com'));}catch{throw new Error('Google Calendar API base URL must be valid');}
  if(!['http:','https:'].includes(url.protocol))throw new Error(`unsupported Google Calendar API scheme: ${url.protocol}`);
  if(url.username||url.password)throw new Error('Google Calendar API base URL must not contain credentials');
  url.hash='';url.search='';return url;
}

function requireToken(value){const token=String(value??'').trim();if(!token)throw new Error('Google Calendar access token is required');return token;}
function httpError(status){const error=new Error(`Google Calendar HTTP ${status}`);error.code=`HTTP_${status}`;error.retryable=status===429||status>=500;return error;}

async function readBoundedJson(response,maxBytes){
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maxBytes){const e=new Error(`Google Calendar response exceeds maxBytes (${maxBytes})`);e.retryable=false;throw e;}
  if(!response.body)return null;
  const reader=response.body.getReader();const chunks=[];let total=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>maxBytes){await reader.cancel('body limit');const e=new Error(`Google Calendar response exceeds maxBytes (${maxBytes})`);e.retryable=false;throw e;}chunks.push(value);}
  }finally{reader.releaseLock();}
  if(!total)return null;const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{const e=new Error('Google Calendar returned invalid JSON');e.retryable=false;throw e;}
}

function normalizeEvent(event){
  if(!event||typeof event!=='object')return null;
  return {id:event.id??null,title:event.summary??'',start:event.start?.dateTime??event.start?.date??null,end:event.end?.dateTime??event.end?.date??null,status:event.status??null,htmlLink:event.htmlLink??null};
}

function eventBody(input={}){
  const source=input.changes&&typeof input.changes==='object'?{...input,...input.changes}:input;
  const title=source.title??source.summary??'';
  const start=source.start;
  let end=source.end;
  if(!end&&source.duration&&start){
    const ms=Number(source.duration);
    if(Number.isFinite(ms)&&ms>0)end=new Date(new Date(start).getTime()+ms).toISOString();
  }
  if(!start||!end)throw new Error('Google Calendar start and end are required');
  return {summary:String(title??''),start:{dateTime:String(start)},end:{dateTime:String(end)}};
}

export function createGoogleCalendarProvider({accessToken,calendarId='primary',apiBaseUrl='https://www.googleapis.com',timeoutMs=5000,maxBytes=256*1024,fetchImpl=globalThis.fetch}={}){
  const token=requireToken(accessToken);
  const base=normalizeBaseUrl(apiBaseUrl);
  const selectedCalendar=String(calendarId??'primary').trim()||'primary';
  if(typeof fetchImpl!=='function')throw new Error('Google Calendar provider requires fetch implementation');
  if(!Number.isInteger(timeoutMs)||timeoutMs<=0)throw new Error('Google Calendar timeoutMs must be a positive integer');
  if(!Number.isInteger(maxBytes)||maxBytes<=0)throw new Error('Google Calendar maxBytes must be a positive integer');
  const calendarPath=`/calendar/v3/calendars/${encodeURIComponent(selectedCalendar)}/events`;

  async function request(method,path,{query,body}={}){
    const target=new URL(path,base);
    if(target.origin!==base.origin){const e=new Error('Google Calendar target escaped configured origin');e.retryable=false;throw e;}
    for(const [key,value] of Object.entries(query??{})){if(value!==undefined&&value!==null)target.searchParams.set(key,String(value));}
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const headers={accept:'application/json',authorization:`Bearer ${token}`};if(body!==undefined)headers['content-type']='application/json';
      const response=await fetchImpl(target,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:controller.signal});
      if([301,302,303,307,308].includes(response.status)){try{await response.body?.cancel();}catch{}const e=new Error('Google Calendar redirects are not allowed');e.retryable=false;throw e;}
      if(response.status>=400){try{await response.body?.cancel();}catch{}throw httpError(response.status);}
      return readBoundedJson(response,maxBytes);
    }catch(error){if(error?.name==='AbortError'){const e=new Error('Google Calendar request timed out');e.code='TIMEOUT';e.retryable=true;throw e;}throw error;}finally{clearTimeout(timer);}
  }

  return {
    capabilities:()=>['calendar.list','calendar.create','calendar.update'],
    async run(operation,input={}){
      if(operation==='list'){
        const payload=await request('GET',calendarPath,{query:{timeMin:input.from??input.timeMin,timeMax:input.to??input.timeMax,singleEvents:true,orderBy:'startTime',maxResults:250}});
        return {events:(payload?.items??[]).map(normalizeEvent).filter(Boolean),provider:'google-calendar'};
      }
      if(operation==='create'){const payload=await request('POST',calendarPath,{body:eventBody(input)});return {event:normalizeEvent(payload),provider:'google-calendar'};}
      if(operation==='update'){
        const eventId=String(input.eventId??'').trim();if(!eventId)throw new Error('Google Calendar eventId is required');
        const payload=await request('PATCH',`${calendarPath}/${encodeURIComponent(eventId)}`,{body:eventBody(input)});return {event:normalizeEvent(payload),provider:'google-calendar'};
      }
      throw new Error(`calendar operation not supported: ${operation}`);
    },
  };
}
