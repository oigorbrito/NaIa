import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createFileMediaDuplicateStore, createFixtureMediaHashProvider, createMediaDuplicateService, registerMediaDuplicateCapability } from '../../src/product/media-duplicates.mjs';

test('byte-identical media groups deterministically as EXACT duplicates',async()=>{
  const provider=createFixtureMediaHashProvider();
  const service=createMediaDuplicateService({hashProvider:provider});
  const result=await service.analyze([
    {id:'b',sizeBytes:10,modifiedAt:'1',exactHash:'aaaaaaaa',perceptualHash:'00000000'},
    {id:'a',sizeBytes:10,modifiedAt:'1',exactHash:'aaaaaaaa',perceptualHash:'00000000'},
    {id:'c',sizeBytes:10,modifiedAt:'1',exactHash:'bbbbbbbb',perceptualHash:'ffffffff'},
  ]);
  assert.equal(result.exactGroups.length,1);
  assert.equal(result.exactGroups[0].kind,'EXACT');
  assert.deepEqual(result.exactGroups[0].members,['a','b']);
  assert.equal(result.exactGroups[0].confidence,1);
});

test('near-identical images group perceptually while remaining distinct from exact duplicates',async()=>{
  const provider=createFixtureMediaHashProvider();
  const service=createMediaDuplicateService({hashProvider:provider,perceptualDistance:2});
  const result=await service.analyze([
    {id:'a',sizeBytes:10,modifiedAt:'1',exactHash:'aaaaaaaa',perceptualHash:'00000000'},
    {id:'b',sizeBytes:11,modifiedAt:'1',exactHash:'bbbbbbbb',perceptualHash:'00000001'},
  ]);
  assert.equal(result.exactGroups.length,0);
  assert.equal(result.perceptualGroups.length,1);
  assert.equal(result.perceptualGroups[0].kind,'PERCEPTUAL');
  assert.deepEqual(result.perceptualGroups[0].members,['a','b']);
  assert.ok(result.perceptualGroups[0].similarity<1);
});

test('perceptual false-positive boundary excludes images beyond configured Hamming distance',async()=>{
  const provider=createFixtureMediaHashProvider();
  const service=createMediaDuplicateService({hashProvider:provider,perceptualDistance:1});
  const result=await service.analyze([
    {id:'a',sizeBytes:10,modifiedAt:'1',exactHash:'aaaaaaaa',perceptualHash:'00000000'},
    {id:'b',sizeBytes:11,modifiedAt:'1',exactHash:'bbbbbbbb',perceptualHash:'00000003'},
  ]);
  assert.equal(result.perceptualGroups.length,0);
});

test('unsupported media is explicit and not placed in duplicate groups',async()=>{
  const provider=createFixtureMediaHashProvider();
  const service=createMediaDuplicateService({hashProvider:provider});
  const result=await service.analyze([
    {id:'x',sizeBytes:1,modifiedAt:'1',unsupported:true},
    {id:'y',sizeBytes:1,modifiedAt:'1',exactHash:'aaaaaaaa',perceptualHash:'00000000'},
  ]);
  assert.equal(result.stats.unsupported,1);
  assert.equal(result.groups.length,0);
  assert.equal(result.fingerprints.find(r=>r.itemId==='x').supported,false);
});

test('unchanged inventory reuses persisted fingerprints across restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-duplicates-'));
  try{
    const provider=createFixtureMediaHashProvider();
    const items=[
      {id:'a',sizeBytes:10,modifiedAt:'1',exactHash:'aaaaaaaa',perceptualHash:'00000000'},
      {id:'b',sizeBytes:10,modifiedAt:'1',exactHash:'aaaaaaaa',perceptualHash:'00000000'},
    ];
    const first=createMediaDuplicateService({store:createFileMediaDuplicateStore({rootDir:dir}),hashProvider:provider});
    const initial=await first.analyze(items);
    assert.equal(initial.stats.processed,2);
    const second=createMediaDuplicateService({store:createFileMediaDuplicateStore({rootDir:dir}),hashProvider:provider});
    const repeated=await second.analyze(items);
    assert.equal(repeated.stats.processed,0);
    assert.equal(repeated.stats.reused,2);
    assert.equal(provider.callCount(),2);
    assert.equal(repeated.exactGroups.length,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('changed item version is reprocessed incrementally without rehashing unchanged peers',async()=>{
  const provider=createFixtureMediaHashProvider();
  const service=createMediaDuplicateService({hashProvider:provider});
  await service.analyze([
    {id:'a',sizeBytes:10,modifiedAt:'1',exactHash:'aaaaaaaa',perceptualHash:'00000000'},
    {id:'b',sizeBytes:10,modifiedAt:'1',exactHash:'aaaaaaaa',perceptualHash:'00000000'},
  ]);
  const second=await service.analyze([
    {id:'a',sizeBytes:10,modifiedAt:'2',exactHash:'cccccccc',perceptualHash:'11111111'},
    {id:'b',sizeBytes:10,modifiedAt:'1',exactHash:'aaaaaaaa',perceptualHash:'00000000'},
  ]);
  assert.equal(second.stats.processed,1);
  assert.equal(second.stats.reused,1);
  assert.equal(provider.callCount(),3);
});

test('duplicate analysis registers as a read-only inventory capability',()=>{
  const service=createMediaDuplicateService({hashProvider:createFixtureMediaHashProvider()});
  let definition;
  const naia={registerCapability(value){definition=value;return {name:value.name,risk:value.tool.risk};}};
  const registered=registerMediaDuplicateCapability(naia,{service,inventory:{async list(){return [];}}});
  assert.deepEqual(registered,{name:'media.duplicates',risk:'READ_ONLY'});
  assert.equal(definition.tool.capability,'media.duplicates');
});
