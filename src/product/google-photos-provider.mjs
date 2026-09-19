function clone(v){return v==null?v:structuredClone(v);}

function googlePhotosError(status){
  const e=new Error('Google Photos API request failed');
  if(status===401){e.code='AUTH_FAILED';e.retryable=false;}
  else if(status===403){e.code='PERMISSION_DENIED';e.retryable=false;}
  else if(status===404){e.code='NOT_FOUND';e.retryable=false;}
  else if(status===429){e.code='RATE_LIMITED';e.retryable=true;}
  else if(status>=500){e.code='PROVIDER_UNAVAILABLE';e.retryable=true;}
  else {e.code='PROVIDER_ERROR';e.retryable=false;}
  e.status=status;
  return e;
}

async function requestJson({provider,url,accessToken,fetchImpl=globalThis.fetch,method='GET',body=null}){
  if(!accessToken)throw new Error(provider+' access token is required');
  if(typeof fetchImpl!=='function')throw new Error('fetch implementation is required');
  const headers={accept:'application/json',authorization:'Bearer '+accessToken};
  if(body!==null)headers['content-type']='application/json';
  const response=await fetchImpl(url,{method,headers,body:body===null?undefined:JSON.stringify(body),redirect:'manual'});
  if([301,302,303,307,308].includes(response.status)){const e=new Error(provider+' redirects are not allowed');e.code='REDIRECT_BLOCKED';e.retryable=false;throw e;}
  if(!response.ok)throw googlePhotosError(response.status);
  if(response.status===204)return null;
  return response.json();
}

function normalizePickerItem(item){
  const meta=item?.mediaFile?.mediaFileMetadata??item?.mediaMetadata??{};
  return {
    id:String(item?.id??''),
    mimeType:item?.mediaFile?.mimeType??item?.mimeType??null,
    width:meta?.width!=null?Number(meta.width):null,
    height:meta?.height!=null?Number(meta.height):null,
    createdAt:meta?.creationTime??null,
    mediaUrl:item?.mediaFile?.baseUrl??item?.baseUrl??null,
    mediaUrlExpiresAt:item?.mediaFile?.baseUrlExpirationTime??item?.baseUrlExpirationTime??null,
    productUrl:item?.productUrl??null,
    filename:item?.mediaFile?.filename??item?.filename??null,
  };
}

export function createGooglePhotosLiveProvider({
  accessToken,
  pickerBaseUrl='https://photospicker.googleapis.com',
  libraryBaseUrl='https://photoslibrary.googleapis.com',
  fetchImpl=globalThis.fetch,
  maxItemCount=2000,
  pageSize=100,
}={}){
  const pickerRoot=String(pickerBaseUrl).replace(/\/$/,'');
  const libraryRoot=String(libraryBaseUrl).replace(/\/$/,'');
  return {
    name:'google_photos',
    capabilities(){return ['select','read-selected','create-app-album'];},
    async authorization(){return {state:'AUTHORIZED'};},
    async beginSelection(){
      const session=await requestJson({
        provider:'google-photos-picker',
        url:pickerRoot+'/v1/sessions',
        accessToken,
        fetchImpl,
        method:'POST',
        body:{pickingConfig:{maxItemCount:String(Math.min(Math.max(Number(maxItemCount)||0,0),2000))}},
      });
      return {
        authorizationState:'AUTHORIZED',
        sessionId:String(session?.id??''),
        pickerUri:session?.pickerUri??null,
        pollingConfig:clone(session?.pollingConfig??null),
        expireTime:session?.expireTime??null,
        userActionRequired:true,
      };
    },
    async page({sessionId,pageToken=null}={}){
      if(!sessionId)throw new Error('Google Photos picker sessionId is required');
      const sessionUrl=pickerRoot+'/v1/sessions/'+encodeURIComponent(String(sessionId));
      const session=await requestJson({provider:'google-photos-picker',url:sessionUrl,accessToken,fetchImpl});
      if(!session?.mediaItemsSet){
        return {
          authorizationState:'AUTHORIZED',
          items:[],
          nextPageToken:null,
          complete:false,
          pending:true,
          pollingConfig:clone(session?.pollingConfig??null),
          expireTime:session?.expireTime??null,
        };
      }
      const url=new URL(pickerRoot+'/v1/mediaItems');
      url.searchParams.set('sessionId',String(sessionId));
      url.searchParams.set('pageSize',String(Math.min(Math.max(Number(pageSize)||1,1),100)));
      if(pageToken)url.searchParams.set('pageToken',String(pageToken));
      const raw=await requestJson({provider:'google-photos-picker',url,accessToken,fetchImpl});
      const nextPageToken=raw?.nextPageToken??null;
      return {
        authorizationState:'AUTHORIZED',
        items:(raw?.mediaItems??[]).map(normalizePickerItem).filter((item)=>item.id),
        nextPageToken,
        complete:!nextPageToken,
      };
    },
    async deleteSelectionSession(sessionId){
      if(!sessionId)return {deleted:false};
      const url=pickerRoot+'/v1/sessions/'+encodeURIComponent(String(sessionId));
      await requestJson({provider:'google-photos-picker',url,accessToken,fetchImpl,method:'DELETE'});
      return {deleted:true};
    },
    async createAppAlbum({title}){
      const raw=await requestJson({
        provider:'google-photos-library',
        url:libraryRoot+'/v1/albums',
        accessToken,
        fetchImpl,
        method:'POST',
        body:{album:{title:String(title)}},
      });
      return {providerAlbumId:String(raw?.id??''),title:raw?.title??String(title),productUrl:raw?.productUrl??null,isWriteable:raw?.isWriteable??null};
    },
  };
}
