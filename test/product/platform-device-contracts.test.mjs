import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlatformRegistry, createPlatformRuntime, createReferenceAdapters } from '../../src/product/platform.mjs';

test('android and ios implement the same common device capability contract',()=>{
  const adapters=createReferenceAdapters();
  const android=new Set(adapters.android.capabilities());
  const ios=new Set(adapters.ios.capabilities());
  assert.deepEqual([...android].sort(),[...ios].sort());
  for(const capability of ['files.list','notifications.show','secure.credentials','background.schedule','media.read']){
    assert.equal(android.has(capability),true);
  }
});

test('platform registry reports capabilities without importing platform-specific APIs into core',()=>{
  const adapters=createReferenceAdapters();
  const registry=createPlatformRegistry();
  registry.register('android',adapters.android);
  registry.register('ios',adapters.ios);
  assert.ok(registry.capabilities('android').includes('notifications.show'));
  assert.ok(registry.capabilities('ios').includes('secure.credentials'));
});

test('notification behavior is identical across android and ios reference adapters',async()=>{
  const adapters=createReferenceAdapters();
  const a=await adapters.android.invoke('notifications.show',{operation:'show',title:'Approval needed',body:'Open NaIA',context:{objectiveId:'o1'}});
  const i=await adapters.ios.invoke('notifications.show',{operation:'show',title:'Approval needed',body:'Open NaIA',context:{objectiveId:'o1'}});
  assert.deepEqual(a,i);
});

test('secure credential access is isolated per platform adapter',async()=>{
  const adapters=createReferenceAdapters();
  await adapters.android.invoke('secure.credentials',{operation:'write',key:'slack-token',value:'android-secret'});
  await adapters.ios.invoke('secure.credentials',{operation:'write',key:'slack-token',value:'ios-secret'});
  assert.equal((await adapters.android.invoke('secure.credentials',{operation:'read',key:'slack-token'})).value,'android-secret');
  assert.equal((await adapters.ios.invoke('secure.credentials',{operation:'read',key:'slack-token'})).value,'ios-secret');
});

test('web unsupported media operation returns explicit capability-unavailable outcome',async()=>{
  const adapters=createReferenceAdapters();
  await assert.rejects(
    adapters.web.invoke('media.read',{operation:'read'}),
    (error)=>error.code==='CAPABILITY_UNAVAILABLE'&&error.availability==='UNSUPPORTED',
  );
});

test('permission-required capability fails explicitly until permission is granted',async()=>{
  const adapters=createReferenceAdapters();
  await assert.rejects(
    adapters.web.invoke('notifications.show',{operation:'show',title:'x',body:'y'}),
    (error)=>error.code==='PERMISSION_REQUIRED'&&error.permissions.includes('notifications'),
  );
  adapters.web.grant('notifications');
  const shown=await adapters.web.invoke('notifications.show',{operation:'show',title:'x',body:'y'});
  assert.equal(shown.shown,true);
});

test('revoking permission immediately blocks future sensitive calls',async()=>{
  const adapters=createReferenceAdapters();
  await adapters.android.invoke('secure.credentials',{operation:'write',key:'token',value:'secret'});
  adapters.android.revoke('secure-storage');
  await assert.rejects(
    adapters.android.invoke('secure.credentials',{operation:'read',key:'token'}),
    (error)=>error.code==='PERMISSION_REQUIRED',
  );
});

test('background scheduling uses one stable domain contract across windows android and ios',async()=>{
  const adapters=createReferenceAdapters();
  for(const name of ['windows','android','ios']){
    const scheduled=await adapters[name].invoke('background.schedule',{operation:'schedule',id:'job-1',task:{kind:'REMINDER'}});
    assert.deepEqual(scheduled,{id:'job-1',scheduled:true});
    const cancelled=await adapters[name].invoke('background.schedule',{operation:'cancel',id:'job-1'});
    assert.deepEqual(cancelled,{id:'job-1',cancelled:true});
  }
});

test('platform runtime exposes current platform description and invoke without leaking other adapters',async()=>{
  const adapters=createReferenceAdapters();
  const registry=createPlatformRegistry();
  registry.register('android',adapters.android);
  registry.register('ios',adapters.ios);
  const runtime=createPlatformRuntime({platform:'android',registry});
  assert.equal(runtime.platform,'android');
  assert.equal(runtime.describe('media.read').platform,'android');
  assert.ok(runtime.capabilities().includes('files.list'));
  const result=await runtime.invoke('files.list',{operation:'list',entries:['a','b']});
  assert.deepEqual(result,{entries:['a','b']});
});
