import { Buffer } from 'node:buffer';

function clone(value){return value==null?value:structuredClone(value);}

function googleHttpError(status){
  const e=new Error('Google API request failed');
  if(status===401){e.code='AUTH_FAILED';e.retryable=false;}
  else if(status===403){e.code='PERMISSION_DENIED';e.retryable=false;}
  else if(status===404){e.code='NOT_FOUND';e.retryable=false;}
  else if(status===429){e.code='RATE_LIMITED';e.retryable=true;}
  else if(status>=500){e.code='PROVIDER_UNAVAILABLE';e.retryable=true;}
  else {e.code='PROVIDER_ERROR';e.retryable=false;}
  e.status=status;
  return e;
}

async function googleRequest({accessToken,url,fetchImpl=globalThis.fetch,method='GET',body=null,responseType='json'}){
  if(!accessToken)throw new Error('Google OAuth access token is required');
  if(typeof fetchImpl!=='function')throw new Error('fetch implementation is required');
  const headers={accept:'application/json',authorization:'Bearer '+accessToken};
  if(body!==null)headers['content-type']='application/json';
  const response=await fetchImpl(url,{method,headers,body:body===null?undefined:JSON.stringify(body),redirect:'manual'});
  if([301,302,303,307,308].includes(response.status)){const e=new Error('Google API redirects are not allowed');e.code='REDIRECT_BLOCKED';e.retryable=false;throw e;}
  if(!response.ok)throw googleHttpError(response.status);
  if(responseType==='text')return response.text();
  return response.json();
}

function headerMap(payload){
  const out={};
  for(const row of payload?.headers??[])out[String(row?.name??'').toLowerCase()]=row?.value??'';
  return out;
}

function decodeBase64Url(value){
  if(!value)return '';
  return Buffer.from(String(value).replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8');
}

function messageBody(part){
  if(!part)return '';
  if(part.mimeType==='text/plain'&&part.body?.data)return decodeBase64Url(part.body.data);
  for(const child of part.parts??[]){
    const text=messageBody(child);
    if(text)return text;
  }
  if(part.body?.data)return decodeBase64Url(part.body.data);
  return '';
}

function normalizeGmailMessage(raw,{includeBody=false}={}){
  const headers=headerMap(raw?.payload);
  return {
    id:raw?.id??null,
    threadId:raw?.threadId??null,
    from:headers.from??'',
    to:headers.to??'',
    subject:headers.subject??'',
    date:headers.date??null,
    snippet:raw?.snippet??null,
    ...(includeBody?{body:messageBody(raw?.payload)}:{}),
  };
}

function rfcMessage({to,subject='',body='',inReplyTo=null}){
  const lines=[
    'To: '+String(to),
    'Subject: '+String(subject).replace(/\r?\n/g,' '),
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ];
  if(inReplyTo){
    lines.push('In-Reply-To: '+String(inReplyTo).replace(/\r?\n/g,' '));
    lines.push('References: '+String(inReplyTo).replace(/\r?\n/g,' '));
  }
  lines.push('',String(body??''));
  return Buffer.from(lines.join('\r\n'),'utf8').toString('base64url');
}

export function createGmailProvider({accessToken,userId='me',apiBaseUrl='https://gmail.googleapis.com',fetchImpl=globalThis.fetch,maxResults=50}={}){
  const root=String(apiBaseUrl).replace(/\/$/,'');
  const user=encodeURIComponent(String(userId||'me'));
  return {
    name:'gmail',
    async search({query='' }={}){
      const url=new URL(root+'/gmail/v1/users/'+user+'/messages');
      if(String(query).trim())url.searchParams.set('q',String(query));
      url.searchParams.set('maxResults',String(maxResults));
      const listed=await googleRequest({accessToken,url,fetchImpl});
      const messages=[];
      for(const row of listed?.messages??[]){
        const detailUrl=new URL(root+'/gmail/v1/users/'+user+'/messages/'+encodeURIComponent(row.id));
        detailUrl.searchParams.set('format','metadata');
        for(const name of ['From','To','Subject','Date'])detailUrl.searchParams.append('metadataHeaders',name);
        const detail=await googleRequest({accessToken,url:detailUrl,fetchImpl});
        messages.push(normalizeGmailMessage(detail));
      }
      return messages;
    },
    async read({messageId}){
      const url=new URL(root+'/gmail/v1/users/'+user+'/messages/'+encodeURIComponent(String(messageId)));
      url.searchParams.set('format','full');
      const raw=await googleRequest({accessToken,url,fetchImpl});
      return normalizeGmailMessage(raw,{includeBody:true});
    },
    async send(input){
      const url=root+'/gmail/v1/users/'+user+'/messages/send';
      const raw=rfcMessage(input);
      const result=await googleRequest({accessToken,url,fetchImpl,method:'POST',body:{raw}});
      return {id:result?.id??null,threadId:result?.threadId??null,to:input.to,subject:input.subject??'',body:input.body??'',inReplyTo:input.inReplyTo??null};
    },
  };
}

function escapeDriveLiteral(value){return String(value).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
function normalizeDriveFile(file){
  return {
    id:String(file?.id??''),
    name:file?.name??null,
    mimeType:file?.mimeType??null,
    modifiedAt:file?.modifiedTime??null,
    sizeBytes:file?.size!=null?Number(file.size):null,
    webViewLink:file?.webViewLink??null,
  };
}

const GOOGLE_EXPORTS=new Map([
  ['application/vnd.google-apps.document','text/plain'],
  ['application/vnd.google-apps.spreadsheet','text/csv'],
]);

function isDirectTextMime(mime){
  return String(mime??'').startsWith('text/')||['application/json','application/xml','application/csv'].includes(String(mime??''));
}

export function createGoogleDriveProvider({accessToken,scopes=['https://www.googleapis.com/auth/drive.readonly'],apiBaseUrl='https://www.googleapis.com',fetchImpl=globalThis.fetch,maxResults=100}={}){
  const root=String(apiBaseUrl).replace(/\/$/,'');
  return {
    name:'google_drive',
    async status(){return {state:'CONNECTED',scopes:[...scopes]};},
    async search({query='' }={}){
      const url=new URL(root+'/drive/v3/files');
      const q=String(query).trim();
      url.searchParams.set('pageSize',String(maxResults));
      url.searchParams.set('fields','files(id,name,mimeType,modifiedTime,size,webViewLink)');
      url.searchParams.set('q',q?("trashed = false and (name contains '"+escapeDriveLiteral(q)+"' or fullText contains '"+escapeDriveLiteral(q)+"')"):'trashed = false');
      const raw=await googleRequest({accessToken,url,fetchImpl});
      return (raw?.files??[]).map(normalizeDriveFile);
    },
    async read({fileId}){
      const id=encodeURIComponent(String(fileId));
      const metaUrl=new URL(root+'/drive/v3/files/'+id);
      metaUrl.searchParams.set('fields','id,name,mimeType,modifiedTime,size,webViewLink,capabilities(canDownload)');
      const meta=await googleRequest({accessToken,url:metaUrl,fetchImpl});
      if(meta?.capabilities?.canDownload===false){const e=new Error('drive file download not permitted');e.code='PERMISSION_DENIED';e.retryable=false;throw e;}
      let content;
      if(GOOGLE_EXPORTS.has(meta?.mimeType)){
        const exportUrl=new URL(root+'/drive/v3/files/'+id+'/export');
        exportUrl.searchParams.set('mimeType',GOOGLE_EXPORTS.get(meta.mimeType));
        content=await googleRequest({accessToken,url:exportUrl,fetchImpl,responseType:'text'});
      }else if(isDirectTextMime(meta?.mimeType)){
        const mediaUrl=new URL(root+'/drive/v3/files/'+id);
        mediaUrl.searchParams.set('alt','media');
        content=await googleRequest({accessToken,url:mediaUrl,fetchImpl,responseType:'text'});
      }else{
        const e=new Error('Drive file MIME type is not supported for text read');
        e.code='UNSUPPORTED_MIME';
        e.retryable=false;
        throw e;
      }
      return {...normalizeDriveFile(meta),content,sourceUrl:meta?.webViewLink??null};
    },
  };
}
