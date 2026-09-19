import assert from 'node:assert/strict';
import test from 'node:test';
import { createMobileClient, parseNaiaDeepLink } from '../../src/product/mobile-client.mjs';
import { createPlatformRegistry, createPlatformRuntime, createReferenceAdapters } from '../../src/product/platform.mjs';

function fakeFrontend(){
  const calls=[];
  return {
    calls,
    async shell(){return {ok:true,navigation:['chat','approvals'],surfaces:{history:{ok:true,objectives:[{id:'o1',title:'Cached objective',status:'WAITING_APPROVAL'}]},approvals:{ok:true,approvals:[{objectiveId:'o1',tool:'email.send'}],confirmations:[{objectiveId:'o2',confirmationId:'c1'}]},automations:{ok:true,items:[{id:'t1'}]},premium:{ok:true},connectors:{ok:true}}};},
    async submit({text}){calls.push(['submit',text]);return {ok:true,objective:{id:'new',title:text,status:'COMPLETED'}};},
    async objective(id){calls.push(['objective',id]);return {ok:true,objective:{id,status:'COMPLETED'}};},
    async approvals(){calls.push(['approvals']);return {ok:true,approvals:[{objectiveId:'o1',tool:'email.send'}],confirmations:[{objectiveId:'o2',confirmationId:'c1'}]};},
    async approve(args){calls.push(['approve',args]);return {ok:true,objective:{id:args.objectiveId,status:'COMPLETED'}};},
    async confirm(args){calls.push(['confirm',args]);return {ok:true,objective:{id:args.objectiveId,status:'COMPLETED'}};},
    async automations(){calls.push(['automations']);return {ok:true,items:[{id:'t1'}]};},
    async cancelAutomation(id){calls.push(['cancelAutomation',id]);return {ok:true,item:{id,userState:'CANCELLED'}};},
  };
}

function clientFor(platformName){
  const adapters=createReferenceAdapters();
  const registry=createPlatformRegistry();
  registry.register(platformName,adapters[platformName]);
  const platform=createPlatformRuntime({platform:platformName,registry});
  const frontend=fakeFrontend();
  const client=createMobileClient({frontendApi:frontend,platform,now:()=> '2026-09-19T15:00:00Z'});
  return {client,frontend,adapter:adapters[platformName]};
}

for(const platformName of ['android','ios']){
  test(`${platformName} shared contract stores token only in secure adapter and exposes token-free session`,async()=>{
    const {client,adapter}=clientFor(platformName);
    const session=await client.signIn({userId:'u1',sessionToken:'secret-token'});
    assert.deepEqual(session,{signedIn:true,userId:'u1',signedInAt:'2026-09-19T15:00:00Z'});
    assert.equal(JSON.stringify(client.session()).includes('secret-token'),false);
    assert.equal((await adapter.invoke('secure.credentials',{operation:'read',key:'naia.session.token'})).value,'secret-token');
  });

  test(`${platformName} bootstrap caches shell and offline mode is read-only`,async()=>{
    const {client,frontend}=clientFor(platformName);
    const online=await client.bootstrap();
    assert.equal(online.ok,true);
    client.setOnline(false);
    const cached=await client.bootstrap();
    assert.equal(cached.offline,true);
    assert.equal(cached.cached,true);
    assert.equal((await client.objective('o1')).objective.id,'o1');
    const approvals=await client.approvals();
    assert.equal(approvals.offline,true);
    await assert.rejects(client.submit('hello'),(error)=>error.code==='OFFLINE_READ_ONLY');
    await assert.rejects(client.approve({objectiveId:'o1',tool:'email.send'}),(error)=>error.code==='OFFLINE_READ_ONLY');
    assert.equal(frontend.calls.some(([name])=>name==='approve'),false);
  });

  test(`${platformName} approval and confirmation actions always delegate to frontend/runtime`,async()=>{
    const {client,frontend}=clientFor(platformName);
    const a=await client.approve({objectiveId:'o1',tool:'email.send'});
    const c=await client.confirm({objectiveId:'o2',confirmationId:'c1'});
    assert.equal(a.ok,true); assert.equal(c.ok,true);
    assert.deepEqual(frontend.calls.filter(([name])=>name==='approve'||name==='confirm'),[
      ['approve',{objectiveId:'o1',tool:'email.send'}],
      ['confirm',{objectiveId:'o2',confirmationId:'c1'}],
    ]);
  });

  test(`${platformName} notification deep links preserve objective/approval context`,async()=>{
    const {client}=clientFor(platformName);
    const shown=await client.notifyApproval({objectiveId:'o1',tool:'email.send'});
    assert.equal(shown.shown,true);
    const route=await client.openDeepLink(shown.context.deepLink);
    assert.equal(route.route,'approval');
    assert.equal(route.objectiveId,'o1');
    assert.equal(route.tool,'email.send');
  });

  test(`${platformName} background and device bridges use shared platform contracts`,async()=>{
    const {client}=clientFor(platformName);
    const scheduled=await client.scheduleBackground({id:'job1',task:{kind:'SYNC'}});
    assert.deepEqual(scheduled,{id:'job1',scheduled:true});
    const media=await client.invokeDevice('media.read',{operation:'read',items:['photo1']});
    assert.deepEqual(media,{items:['photo1']});
    const cancelled=await client.cancelBackground('job1');
    assert.deepEqual(cancelled,{id:'job1',cancelled:true});
  });
}

test('deep-link parser rejects non-NaIA links and parses confirmation context',()=>{
  assert.throws(()=>parseNaiaDeepLink('https://example.com/o1'),(error)=>error.code==='INVALID_DEEP_LINK');
  assert.deepEqual(parseNaiaDeepLink('naia://confirmation/o2?confirmationId=c1'),{kind:'confirmation',id:'o2',tool:null,confirmationId:'c1'});
});

test('sign out deletes secure session and clears offline cache',async()=>{
  const {client,adapter}=clientFor('android');
  await client.signIn({userId:'u1',sessionToken:'secret-token'});
  await client.bootstrap();
  await client.signOut();
  assert.equal(client.session().signedIn,false);
  assert.equal((await adapter.invoke('secure.credentials',{operation:'read',key:'naia.session.token'})).value,null);
  client.setOnline(false);
  const bootstrap=await client.bootstrap();
  assert.equal(bootstrap.error.code,'OFFLINE_NO_CACHE');
});
