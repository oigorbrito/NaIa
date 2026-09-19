import assert from 'node:assert/strict';
import test from 'node:test';
import { createGooglePhotosLiveProvider } from '../../src/product/google-photos-provider.mjs';
import { createPhotosIntakeService } from '../../src/product/photos-intake.mjs';

function jsonResponse(body,status=200){return {ok:status>=200&&status<300,status,async json(){return structuredClone(body);}};}

test('live Photos provider starts Picker session and exposes explicit user-action checkpoint',async()=>{
  let seen;
  const provider=createGooglePhotosLiveProvider({
    accessToken:'photos-secret',
    fetchImpl:async(url,options)=>{seen={url:String(url),options};return jsonResponse({
      id:'picker-1',
      pickerUri:'https://photos.google.com/picker/session',
      pollingConfig:{pollInterval:'2s',timeoutIn:'60s'},
      expireTime:'2026-09-19T22:00:00Z',
      mediaItemsSet:false,
    });},
  });
  const start=await provider.beginSelection();
  assert.equal(seen.url,'https://photospicker.googleapis.com/v1/sessions');
  assert.equal(seen.options.headers.authorization,'Bearer photos-secret');
  assert.equal(start.sessionId,'picker-1');
  assert.equal(start.userActionRequired,true);
  assert.equal(start.pickerUri,'https://photos.google.com/picker/session');
  assert.equal(JSON.stringify(start).includes('photos-secret'),false);
});

test('photos intake persists WAITING_USER instead of falsely completing empty Picker session',async()=>{
  let calls=0;
  const provider=createGooglePhotosLiveProvider({
    accessToken:'x',
    fetchImpl:async(url)=>{
      calls+=1;
      assert.equal(String(url),'https://photospicker.googleapis.com/v1/sessions');
      return jsonResponse({id:'picker-1',pickerUri:'https://photos.google.com/picker/1',mediaItemsSet:false});
    },
  });
  const service=createPhotosIntakeService({idFactory:()=> 'local-1',now:()=> '2026-09-19T20:00:00Z'});
  const result=await service.importSelection({userId:'u1',provider});
  assert.equal(result.status,'WAITING_USER');
  assert.equal(result.session.status,'WAITING_USER');
  assert.equal(result.session.providerSessionId,'picker-1');
  assert.equal(result.pickerUri,'https://photos.google.com/picker/1');
  assert.equal(calls,1);
});

test('resumeSelection stays WAITING_USER while Picker has no completed selection',async()=>{
  let phase=0;
  const fetchImpl=async(url,options)=>{
    const u=String(url);
    if(u.endsWith('/v1/sessions')&&options.method==='POST')return jsonResponse({id:'picker-1',pickerUri:'https://photos.google.com/picker/1'});
    if(u.endsWith('/v1/sessions/picker-1')){phase+=1;return jsonResponse({id:'picker-1',mediaItemsSet:false,pollingConfig:{pollInterval:'3s'}});}
    throw new Error('unexpected '+u);
  };
  let id=0;
  const provider=createGooglePhotosLiveProvider({accessToken:'x',fetchImpl});
  const service=createPhotosIntakeService({idFactory:()=> 'local-'+(++id)});
  const started=await service.importSelection({userId:'u1',provider});
  const resumed=await service.resumeSelection({userId:'u1',provider,sessionId:started.session.id});
  assert.equal(resumed.status,'WAITING_USER');
  assert.deepEqual(resumed.pollingConfig,{pollInterval:'3s'});
  assert.equal(phase,1);
});

test('resumeSelection imports paginated Picker media, preserves provenance and cleans provider session',async()=>{
  const requests=[];
  const fetchImpl=async(url,options)=>{
    const u=String(url);requests.push({url:u,method:options.method});
    if(u.endsWith('/v1/sessions')&&options.method==='POST')return jsonResponse({id:'picker-1',pickerUri:'https://photos.google.com/picker/1'});
    if(u.endsWith('/v1/sessions/picker-1')&&options.method==='GET')return jsonResponse({id:'picker-1',mediaItemsSet:true});
    if(u.includes('/v1/mediaItems?')&&u.includes('pageToken=p2'))return jsonResponse({mediaItems:[{
      id:'p2',
      mediaFile:{mimeType:'video/mp4',filename:'b.mp4',baseUrl:'https://temp/b',baseUrlExpirationTime:'2026-09-19T23:00:00Z',mediaFileMetadata:{width:'1920',height:'1080',creationTime:'2026-09-18T10:00:00Z'}},
    }]});
    if(u.includes('/v1/mediaItems?'))return jsonResponse({mediaItems:[{
      id:'p1',
      mediaFile:{mimeType:'image/jpeg',filename:'a.jpg',baseUrl:'https://temp/a',baseUrlExpirationTime:'2026-09-19T23:00:00Z',mediaFileMetadata:{width:'800',height:'600',creationTime:'2026-09-18T09:00:00Z'}},
    }],nextPageToken:'p2'});
    if(u.endsWith('/v1/sessions/picker-1')&&options.method==='DELETE')return {ok:true,status:204,async json(){return null;}};
    throw new Error('unexpected '+u+' '+options.method);
  };
  let id=0;
  const provider=createGooglePhotosLiveProvider({accessToken:'x',fetchImpl,pageSize:100});
  const service=createPhotosIntakeService({idFactory:()=> 'local-'+(++id),now:()=> '2026-09-19T20:00:00Z'});
  const started=await service.importSelection({userId:'u1',provider});
  const done=await service.resumeSelection({userId:'u1',provider,sessionId:started.session.id});
  assert.equal(done.status,'COMPLETED');
  assert.equal(done.imported,2);
  assert.equal(done.items[0].providerItemId,'p1');
  assert.equal(done.items[0].mimeType,'image/jpeg');
  assert.equal(done.items[0].width,800);
  assert.equal(done.items[0].provenance.providerSessionId,'picker-1');
  assert.ok(requests.some((r)=>r.method==='DELETE'&&r.url.endsWith('/v1/sessions/picker-1')));
});

test('live Photos provider creates only app-owned Library album through albums.create boundary',async()=>{
  let seen;
  const provider=createGooglePhotosLiveProvider({
    accessToken:'x',
    fetchImpl:async(url,options)=>{seen={url:String(url),options};return jsonResponse({id:'album-1',title:'NaIA',productUrl:'https://photos.google.com/album/1',isWriteable:true});},
  });
  const album=await provider.createAppAlbum({title:'NaIA'});
  assert.equal(seen.url,'https://photoslibrary.googleapis.com/v1/albums');
  assert.equal(seen.options.method,'POST');
  assert.deepEqual(JSON.parse(seen.options.body),{album:{title:'NaIA'}});
  assert.equal(album.providerAlbumId,'album-1');
  assert.equal(album.isWriteable,true);
});

test('Photos provider normalizes expired/denied access and blocks redirects',async()=>{
  const denied=createGooglePhotosLiveProvider({accessToken:'x',fetchImpl:async()=>jsonResponse({},403)});
  await assert.rejects(denied.beginSelection(),(error)=>error.code==='PERMISSION_DENIED'&&error.retryable===false);
  const redirected=createGooglePhotosLiveProvider({accessToken:'x',fetchImpl:async()=>jsonResponse({},302)});
  await assert.rejects(redirected.beginSelection(),(error)=>error.code==='REDIRECT_BLOCKED');
});
