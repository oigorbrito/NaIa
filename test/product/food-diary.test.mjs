import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  createFileFoodDiaryStore,
  createFixtureNutritionProvider,
  createFoodDiaryService,
  createMemoryFoodDiaryStore,
  formatFoodDiaryReply,
  parseMealText,
} from '../../src/product/food-diary.mjs';

function provider(){
  return createFixtureNutritionProvider({foods:[
    {id:'egg',name:'ovo',aliases:['ovos'],defaultPortionGrams:50,source:'TBCA-fixture',per100g:{kcal:143,protein:13,carbs:0.7,fat:9.5,fiber:0}},
    {id:'rice',name:'arroz',aliases:['arroz cozido'],defaultPortionGrams:100,source:'TBCA-fixture',per100g:{kcal:130,protein:2.7,carbs:28,fat:0.3,fiber:0.4}},
    {id:'chicken',name:'frango',aliases:['peito de frango'],defaultPortionGrams:120,source:'USDA-fixture',per100g:{kcal:165,protein:31,carbs:0,fat:3.6,fiber:0}},
    {id:'beans',name:'feijão',aliases:['feijao'],defaultPortionGrams:100,source:'TBCA-fixture',per100g:{kcal:76,protein:4.8,carbs:13.6,fat:0.5,fiber:8.5}},
  ]});
}

function service(options={}){let i=0;return createFoodDiaryService({nutritionProvider:provider(),idFactory:()=>`meal-${++i}`,now:()=> '2026-09-19T15:00:00Z',...options});}

test('parser understands explicit count and grams in one message',()=>{
  const parsed=parseMealText('comi dois ovos e 100g de arroz');
  assert.equal(parsed.length,2);
  assert.equal(parsed[0].query,'ovos');
  assert.equal(parsed[0].quantity.count,2);
  assert.equal(parsed[1].query,'arroz');
  assert.equal(parsed[1].quantity.grams,100);
});

test('text meal logs multiple foods with structured provenance and daily kcal',async()=>{
  const diary=service();
  const result=await diary.logText({userId:'u1',text:'comi dois ovos e 100g de arroz',source:{channel:'whatsapp',messageId:'wamid-1'}});
  assert.equal(result.duplicate,false);
  assert.equal(result.meal.items.length,2);
  assert.equal(result.meal.items[0].nutritionSource,'TBCA-fixture');
  assert.equal(result.meal.items[1].grams,100);
  assert.equal(result.summary.dailyKcal,result.summary.kcal);
  assert.equal(result.summary.estimated,true);
  assert.match(formatFoodDiaryReply(result),/Registrado: aprox\./);
});

test('vague meal uses default portion as explicit estimate rather than fake precision',async()=>{
  const diary=service();
  const result=await diary.logText({userId:'u1',text:'comi frango com arroz'});
  assert.equal(result.meal.items.length,2);
  assert.ok(result.meal.items.every(item=>item.estimated===true));
  assert.ok(result.meal.items.every(item=>item.confidence<1));
  assert.equal(result.summary.estimated,true);
});

test('same WhatsApp source message is idempotent across retries',async()=>{
  const diary=service();
  const first=await diary.logText({userId:'u1',text:'comi 100g de arroz',source:{channel:'whatsapp',messageId:'wamid-1'}});
  const retry=await diary.logText({userId:'u1',text:'comi 100g de arroz',source:{channel:'whatsapp',messageId:'wamid-1'}});
  assert.equal(first.duplicate,false);
  assert.equal(retry.duplicate,true);
  assert.equal(retry.meal.id,first.meal.id);
  assert.equal((await diary.dailyTotals('u1','2026-09-19')).mealCount,1);
});

test('natural correction replaces meal items while preserving audit history',async()=>{
  const diary=service();
  const logged=await diary.logText({userId:'u1',text:'comi 100g de arroz'});
  const corrected=await diary.correctMeal({userId:'u1',mealId:logged.meal.id,text:'na verdade eram 2 ovos'});
  assert.equal(corrected.meal.items.length,1);
  assert.equal(corrected.meal.items[0].foodId,'egg');
  assert.equal(corrected.meal.audit[0].type,'CORRECTED');
  assert.equal((await diary.dailyTotals('u1','2026-09-19')).mealCount,1);
});

test('soft delete latest meal removes it from daily totals without erasing audit',async()=>{
  let tick=0;
  const diary=createFoodDiaryService({nutritionProvider:provider(),idFactory:()=>`m${++tick}`,now:()=>`2026-09-19T1${tick}:00:00Z`});
  await diary.logText({userId:'u1',text:'comi 100g de arroz',mealType:'almoço',occurredAt:'2026-09-19T12:00:00Z'});
  const latest=await diary.logText({userId:'u1',text:'comi 100g de frango',mealType:'almoço',occurredAt:'2026-09-19T13:00:00Z'});
  const deleted=await diary.deleteLatestMeal({userId:'u1',date:'2026-09-19',mealType:'almoço'});
  assert.equal(deleted.deleted,true);
  const rows=await diary.listMeals('u1',{date:'2026-09-19'});
  assert.equal(rows.find(r=>r.id===latest.meal.id).status,'DELETED');
  assert.equal((await diary.dailyTotals('u1','2026-09-19')).mealCount,1);
});

test('daily total query aggregates only active meals',async()=>{
  const diary=service();
  const a=await diary.logText({userId:'u1',text:'comi 100g de arroz'});
  await diary.logText({userId:'u1',text:'comi 100g de frango'});
  await diary.deleteMeal({userId:'u1',mealId:a.meal.id});
  const total=await diary.dailyTotals('u1','2026-09-19');
  assert.equal(total.mealCount,1);
  assert.equal(total.kcal,198);
});

test('coaching preference natural language controls whether suggestions appear',async()=>{
  const diary=service();
  await diary.interpretPreference('u1','só registra, sem dicas');
  assert.equal((await diary.preferences('u1')).coachingFrequency,'never');
  const noTip=await diary.logText({userId:'u1',text:'comi 100g de arroz'});
  assert.equal(noTip.summary.coaching,null);
  await diary.interpretPreference('u1','sempre dê dicas');
  const tip=await diary.logText({userId:'u1',text:'comi 100g de frango'});
  assert.equal((await diary.preferences('u1')).coachingFrequency,'always');
  assert.match(tip.summary.coaching,/fibras|verduras|legumes|frutas/i);
});

test('default occasional coaching is deterministic and does not appear every meal',async()=>{
  const diary=service();
  const a=await diary.logText({userId:'u1',text:'comi 100g de arroz',occurredAt:'2026-09-19T09:00:00Z'});
  const b=await diary.logText({userId:'u1',text:'comi 100g de frango',occurredAt:'2026-09-19T12:00:00Z'});
  const c=await diary.logText({userId:'u1',text:'comi 100g de arroz',occurredAt:'2026-09-19T18:00:00Z'});
  assert.equal(a.summary.coaching,null);
  assert.equal(b.summary.coaching,null);
  assert.ok(c.summary.coaching);
});

test('audio transcript uses same text resolution path and records audio modality without raw media ref',async()=>{
  const diary=service();
  const result=await diary.logTranscript({userId:'u1',transcript:'comi 100g de arroz',source:{channel:'whatsapp',messageId:'voice-1',mediaRef:'private-audio'}});
  assert.equal(result.meal.source.modality,'audio');
  assert.equal(result.meal.source.messageId,'voice-1');
  assert.equal('mediaRef' in result.meal.source,false);
});

test('image detections resolve through nutrition provider and minimize media retention',async()=>{
  const diary=service();
  const result=await diary.logDetections({userId:'u1',detections:[{name:'frango',grams:120,confidence:0.82},{name:'arroz',grams:100,confidence:0.9}],source:{channel:'whatsapp',messageId:'img-1',mediaRef:'private-image'}});
  assert.equal(result.meal.source.modality,'image');
  assert.equal(result.meal.items.length,2);
  assert.equal(result.meal.items[0].confidence,0.82);
  assert.equal('mediaRef' in result.meal.source,false);
});

test('ambiguous lookup requests confirmation rather than choosing arbitrarily',async()=>{
  const ambiguousProvider=createFixtureNutritionProvider({foods:[
    {id:'rice1',name:'arroz branco',aliases:['arroz'],defaultPortionGrams:100,source:'A',per100g:{kcal:130}},
    {id:'rice2',name:'arroz integral',aliases:['arroz'],defaultPortionGrams:100,source:'B',per100g:{kcal:124}},
  ]});
  const diary=createFoodDiaryService({nutritionProvider:ambiguousProvider});
  const result=await diary.logText({userId:'u1',text:'comi arroz'});
  assert.equal(result.status,'NEEDS_CONFIRMATION');
  assert.equal(result.ambiguous[0].candidates.length,2);
});

test('unknown food remains explicit and is not hallucinated',async()=>{
  const diary=service();
  const result=await diary.logText({userId:'u1',text:'comi alimento inexistente'});
  assert.equal(result.status,'UNRESOLVED');
  assert.deepEqual(result.unresolved,['alimento inexistente']);
});

test('fiber-containing meal receives neutral variety coaching rather than moral judgment',async()=>{
  const diary=service();
  await diary.setCoachingFrequency('u1','always');
  const result=await diary.logText({userId:'u1',text:'comi 100g de feijão'});
  assert.match(result.summary.coaching,/variar|alternar/i);
  assert.doesNotMatch(result.summary.coaching,/bom|ruim|culpa|proibido/i);
});

test('file-backed diary preserves preferences meals and webhook idempotency across restart',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'naia-food-'));
  try{
    const first=createFoodDiaryService({store:createFileFoodDiaryStore({rootDir:dir}),nutritionProvider:provider(),idFactory:()=> 'meal-1',now:()=> '2026-09-19T15:00:00Z'});
    await first.setCoachingFrequency('u1','never');
    await first.logText({userId:'u1',text:'comi 100g de arroz',source:{channel:'whatsapp',messageId:'wamid-1'}});
    const second=createFoodDiaryService({store:createFileFoodDiaryStore({rootDir:dir}),nutritionProvider:provider(),now:()=> '2026-09-19T16:00:00Z'});
    assert.equal((await second.preferences('u1')).coachingFrequency,'never');
    assert.equal((await second.dailyTotals('u1','2026-09-19')).mealCount,1);
    const retry=await second.logText({userId:'u1',text:'comi 100g de arroz',source:{channel:'whatsapp',messageId:'wamid-1'}});
    assert.equal(retry.duplicate,true);
  }finally{await rm(dir,{recursive:true,force:true});}
});
