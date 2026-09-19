import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createFileSemanticEmbeddingStore, createFixtureEmbeddingProvider, createSemanticMediaGroupingService, registerSemanticMediaGroupingCapability } from '../../src/product/media-semantic-groups.mjs';

test('related images group semantically without filename/path dependence',async()=>{
  const provider=createFixtureEmbeddingProvider({model:'vision-a',version:'1'});
  const service=createSemanticMediaGroupingService({embeddingProvider:provider,threshold:0.95});
  const result=await service.group([
    {id:'a',displayName:'one.jpg',embedding:[1,0],sizeBytes:1,modifiedAt:'1'},
    {id:'b',displayName:'totally-different.png',embedding:[0.99,0.05],sizeBytes:2,modifiedAt:'1'},
    {id:'c',displayName:'one-copy.jpg',embedding:[0,1],sizeBytes:3,modifiedAt:'1'},
  ]);
  assert.equal(result.status,'OK');
  assert.equal(result.groups.length,1);
  assert.deepEqual(result.groups[0].members,['a','b']);
  assert.equal(result.groups[0].model,'vision-a');
  assert.equal(result.groups[0].version,'1');
  assert.equal(result.groups[0].threshold,0.95);
});

test('clustering threshold controls false-positive boundary',async()=>{
  const provider=createFixtureEmbeddingProvider();
  const strict=createSemanticMediaGroupingService({embeddingProvider:provider,threshold:0.99});
  const loose=createSemanticMediaGroupingService({embeddingProvider:provider,threshold:0.9});
  const items=[
    {id:'a',embedding:[1,0],sizeBytes:1,modifiedAt:'1'},
    {id:'b',embedding:[0.95,0.2],sizeBytes:2,modifiedAt:'1'},
  ];
  assert.equal((await strict.group(items)).groups.length,0);
  assert.equal((await loose.group(items)).groups.length,1);
});

test('complete-link grouping prevents transitive semantic false positives',async()=>{
  const provider=createFixtureEmbeddingProvider();
  const service=createSemanticMediaGroupingService({embeddingProvider:provider,threshold:0.9});
  const result=await service.group([
    {id:'a',embedding:[1,0],sizeBytes:1,modifiedAt:'1'},
    {id:'b',embedding:[0.92,0.39],sizeBytes:2,modifiedAt:'1'},
    {id:'c',embedding:[0.7,0.714],sizeBytes:3,modifiedAt:'1'},
  ]);
  assert.ok(result.groups.every(group=>!(group.members.includes('a')&&group.members.includes('c'))));
});

test('unchanged embeddings are reused across restart for same model/version',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-semantic-'));
  try{
    const provider=createFixtureEmbeddingProvider({model:'vision-a',version:'1'});
    const items=[{id:'a',embedding:[1,0],sizeBytes:1,modifiedAt:'1'},{id:'b',embedding:[0.99,0.01],sizeBytes:2,modifiedAt:'1'}];
    const first=createSemanticMediaGroupingService({store:createFileSemanticEmbeddingStore({rootDir:dir}),embeddingProvider:provider,threshold:0.9});
    const initial=await first.group(items);assert.equal(initial.stats.processed,2);
    const second=createSemanticMediaGroupingService({store:createFileSemanticEmbeddingStore({rootDir:dir}),embeddingProvider:provider,threshold:0.9});
    const repeated=await second.group(items);
    assert.equal(repeated.stats.processed,0);assert.equal(repeated.stats.reused,2);assert.equal(provider.callCount(),2);
    assert.equal(repeated.groups[0].id,initial.groups[0].id);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('model-version change invalidates embedding cache even when media is unchanged',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-semantic-version-'));
  try{
    const items=[{id:'a',embedding:[1,0],sizeBytes:1,modifiedAt:'1'}];
    const v1=createFixtureEmbeddingProvider({model:'vision-a',version:'1'});
    await createSemanticMediaGroupingService({store:createFileSemanticEmbeddingStore({rootDir:dir}),embeddingProvider:v1}).group(items);
    const v2=createFixtureEmbeddingProvider({model:'vision-a',version:'2'});
    const result=await createSemanticMediaGroupingService({store:createFileSemanticEmbeddingStore({rootDir:dir}),embeddingProvider:v2}).group(items);
    assert.equal(result.stats.processed,1);
    assert.equal(result.embeddings[0].version,'2');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('unsupported media remains explicit and outside semantic groups',async()=>{
  const provider=createFixtureEmbeddingProvider();
  const service=createSemanticMediaGroupingService({embeddingProvider:provider});
  const result=await service.group([{id:'x',unsupported:true,sizeBytes:1,modifiedAt:'1'}]);
  assert.equal(result.stats.unsupported,1);
  assert.equal(result.groups.length,0);
  assert.equal(result.embeddings[0].supported,false);
});

test('offline embedding provider returns explicit unavailable state without fabricated groups',async()=>{
  const provider=createFixtureEmbeddingProvider({fail:{code:'MODEL_OFFLINE',retryable:true}});
  const service=createSemanticMediaGroupingService({embeddingProvider:provider});
  const result=await service.group([{id:'a',sizeBytes:1,modifiedAt:'1'}]);
  assert.equal(result.status,'UNAVAILABLE');
  assert.equal(result.groups.length,0);
  assert.deepEqual(result.errors,[{itemId:'a',code:'MODEL_OFFLINE',retryable:true}]);
});

test('semantic grouping registers as read-only inventory capability',()=>{
  const service=createSemanticMediaGroupingService({embeddingProvider:createFixtureEmbeddingProvider()});
  const naia={registerCapability(value){return {name:value.name,risk:value.tool.risk};}};
  const registered=registerSemanticMediaGroupingCapability(naia,{service,inventory:{async list(){return [];}}});
  assert.deepEqual(registered,{name:'media.semanticGroups',risk:'READ_ONLY'});
});
