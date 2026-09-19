import { randomUUID } from 'node:crypto';

const COACHING = new Set(['never','occasional','frequent','always']);
const WORD_NUMBER = new Map([['um',1],['uma',1],['dois',2],['duas',2],['três',3],['tres',3],['quatro',4],['cinco',5],['seis',6]]);

function clone(v){return v==null?v:structuredClone(v);}
function norm(v){return String(v??'').trim().toLowerCase();}
function round1(v){return Math.round(Number(v)*10)/10;}

export function createMemoryFoodDiaryStore(){
  const meals=new Map(); const sourceKeys=new Map(); const prefs=new Map();
  return {
    async saveMeal(row){meals.set(row.id,clone(row));if(row.source?.messageId)sourceKeys.set(`${row.userId}:${row.source.channel}:${row.source.messageId}`,row.id);return clone(row);},
    async getMeal(id){const row=meals.get(String(id));return row?clone(row):null;},
    async findBySource({userId,channel,messageId}){const id=sourceKeys.get(`${userId}:${channel}:${messageId}`);return id?clone(meals.get(id)):null;},
    async listMeals(userId){return [...meals.values()].filter(r=>r.userId===userId).map(clone);},
    async savePrefs(userId,row){prefs.set(userId,clone(row));return clone(row);},
    async getPrefs(userId){return clone(prefs.get(userId)??null);},
  };
}

export function createFixtureNutritionProvider({foods=[]}={}){
  const catalog=foods.map(food=>({
    id:String(food.id),name:String(food.name),aliases:[...new Set([food.name,...(food.aliases??[])].map(norm))],
    per100g:{kcal:Number(food.per100g?.kcal??0),protein:Number(food.per100g?.protein??0),carbs:Number(food.per100g?.carbs??0),fat:Number(food.per100g?.fat??0),fiber:Number(food.per100g?.fiber??0)},
    defaultPortionGrams:Number(food.defaultPortionGrams??100),source:food.source??'fixture',
  }));
  return {
    name:'fixture-nutrition',
    async lookup({query}){
      const q=norm(query);
      const exact=catalog.filter(f=>f.aliases.includes(q));
      if(exact.length)return exact.map(clone);
      return catalog.filter(f=>f.aliases.some(a=>a.includes(q)||q.includes(a))).map(clone);
    },
  };
}

function parseQuantity(text){
  const q=norm(text);
  const grams=q.match(/(\d+(?:[.,]\d+)?)\s*g\b/);
  if(grams)return {kind:'GRAMS',grams:Number(grams[1].replace(',','.')),estimated:false};
  const numeric=q.match(/\b(\d+(?:[.,]\d+)?)\b/);
  if(numeric)return {kind:'COUNT',count:Number(numeric[1].replace(',','.')),estimated:false};
  for(const [word,count] of WORD_NUMBER){if(new RegExp(`\\b${word}\\b`,'i').test(q))return {kind:'COUNT',count,estimated:false};}
  return {kind:'UNKNOWN',estimated:true};
}

export function parseMealText(text){
  let value=String(text??'').trim();
  value=value.replace(/^(eu\s+)?(comi|jantei|almocei|tomei|bebi)\s+/i,'');
  const parts=value.split(/\s+(?:e|com)\s+|,|\+/i).map(s=>s.trim()).filter(Boolean);
  return parts.map(part=>({raw:part,quantity:parseQuantity(part),query:part.replace(/\b\d+(?:[.,]\d+)?\s*g\b/ig,'').replace(/\b\d+(?:[.,]\d+)?\b/g,'').replace(/\b(?:um|uma|dois|duas|três|tres|quatro|cinco|seis)\b/ig,'').replace(/^de\s+/i,'').trim()}));
}

function scaledNutrition(food,grams){
  const factor=grams/100;
  return {kcal:round1(food.per100g.kcal*factor),protein:round1(food.per100g.protein*factor),carbs:round1(food.per100g.carbs*factor),fat:round1(food.per100g.fat*factor),fiber:round1(food.per100g.fiber*factor)};
}

function sanitizeSource(source={}){return {channel:String(source.channel??'chat'),messageId:source.messageId??null,modality:source.modality??'text'};}

function itemFrom(food,parsed){
  let grams,estimated=parsed.quantity.estimated;
  if(parsed.quantity.kind==='GRAMS')grams=parsed.quantity.grams;
  else if(parsed.quantity.kind==='COUNT'){grams=food.defaultPortionGrams*parsed.quantity.count;estimated=true;}
  else {grams=food.defaultPortionGrams;estimated=true;}
  return {
    rawName:parsed.raw,foodId:food.id,name:food.name,grams:round1(grams),quantityKind:parsed.quantity.kind,
    nutrition:scaledNutrition(food,grams),nutritionSource:food.source,confidence:estimated?0.7:0.95,estimated,
  };
}

function totals(items){return items.reduce((acc,item)=>({kcal:round1(acc.kcal+item.nutrition.kcal),protein:round1(acc.protein+item.nutrition.protein),carbs:round1(acc.carbs+item.nutrition.carbs),fat:round1(acc.fat+item.nutrition.fat),fiber:round1(acc.fiber+item.nutrition.fiber)}),{kcal:0,protein:0,carbs:0,fat:0,fiber:0});}

function shouldCoach(mode,mealNumber){if(mode==='never')return false;if(mode==='always')return true;if(mode==='frequent')return mealNumber%2===0;return mealNumber%3===0;}
function coachingText(meal){
  const t=meal.totals;
  if(t.fiber<3)return 'Se fizer sentido para você, uma próxima refeição pode incluir verduras, legumes, frutas ou outra fonte de fibras.';
  return 'Se quiser variar ao longo do dia, tente alternar fontes de proteína, carboidratos, frutas e vegetais.';
}

export function createFoodDiaryService({store=createMemoryFoodDiaryStore(),nutritionProvider,idFactory=randomUUID,now=()=>new Date().toISOString()}={}){
  if(!nutritionProvider||typeof nutritionProvider.lookup!=='function')throw new Error('nutrition provider is required');
  async function prefs(userId){return await store.getPrefs(userId)??{userId,coachingFrequency:'occasional',updatedAt:null};}
  async function resolveText(text){
    const parsed=parseMealText(text);const items=[];const unresolved=[];const ambiguous=[];
    for(const p of parsed){
      const matches=await nutritionProvider.lookup({query:p.query});
      if(matches.length===0){unresolved.push(p.raw);continue;}
      if(matches.length>1){ambiguous.push({raw:p.raw,candidates:matches.map(m=>({id:m.id,name:m.name,source:m.source}))});continue;}
      items.push(itemFrom(matches[0],p));
    }
    return {parsed,items,unresolved,ambiguous};
  }
  return {
    async setCoachingFrequency(userId,frequency){const f=norm(frequency);if(!COACHING.has(f))throw new Error('unsupported coaching frequency');const row={userId,coachingFrequency:f,updatedAt:now()};await store.savePrefs(userId,row);return clone(row);},
    async preferences(userId){return prefs(userId);},
    async interpretPreference(userId,text){
      const q=norm(text);
      if(/s[oó]\s+registra|sem\s+dicas|n[aã]o\s+precisa\s+dar\s+dicas/.test(q))return this.setCoachingFrequency(userId,'never');
      if(/dicas\s+[aà]s\s+vezes|orientar\s+[aà]s\s+vezes|ocasional/.test(q))return this.setCoachingFrequency(userId,'occasional');
      if(/orientar\s+mais|dicas\s+mais\s+frequentes|frequente/.test(q))return this.setCoachingFrequency(userId,'frequent');
      if(/sempre\s+d[êe]\s+dicas|dicas\s+sempre/.test(q))return this.setCoachingFrequency(userId,'always');
      return null;
    },
    async logText({userId,text,source={channel:'chat',messageId:null},occurredAt=now(),mealType=null}){
      if(source?.messageId){const existing=await store.findBySource({userId,channel:source.channel,messageId:source.messageId});if(existing)return {duplicate:true,meal:existing,summary:await this.summaryForMeal(existing.id)};}
      const resolution=await resolveText(text);
      if(resolution.ambiguous.length)return {status:'NEEDS_CONFIRMATION',ambiguous:resolution.ambiguous,unresolved:resolution.unresolved,items:resolution.items};
      if(!resolution.items.length)return {status:'UNRESOLVED',unresolved:resolution.unresolved};
      const meal={id:idFactory(),userId,occurredAt,mealType,source:sanitizeSource(source),status:'ACTIVE',items:resolution.items,unresolved:resolution.unresolved,totals:totals(resolution.items),createdAt:now(),updatedAt:now(),audit:[]};
      await store.saveMeal(meal);return {duplicate:false,meal:clone(meal),summary:await this.summaryForMeal(meal.id)};
    },
    async logTranscript({userId,transcript,source={channel:'voice',messageId:null},occurredAt=now(),mealType=null}){
      return this.logText({userId,text:transcript,source:{...source,modality:'audio'},occurredAt,mealType});
    },
    async logDetections({userId,detections,source={channel:'image',messageId:null},occurredAt=now(),mealType=null}){
      if(source?.messageId){const existing=await store.findBySource({userId,channel:source.channel,messageId:source.messageId});if(existing)return {duplicate:true,meal:existing,summary:await this.summaryForMeal(existing.id)};}
      const items=[];const unresolved=[];const ambiguous=[];
      for(const detection of detections??[]){
        const matches=await nutritionProvider.lookup({query:detection.name});
        if(matches.length===0){unresolved.push(detection.name);continue;}
        if(matches.length>1){ambiguous.push({raw:detection.name,candidates:matches.map(m=>({id:m.id,name:m.name,source:m.source}))});continue;}
        const grams=Number(detection.grams);
        const parsed={raw:String(detection.name),quantity:Number.isFinite(grams)&&grams>0?{kind:'GRAMS',grams,estimated:Boolean(detection.estimated)}:{kind:'UNKNOWN',estimated:true}};
        const item=itemFrom(matches[0],parsed);
        if(Number.isFinite(Number(detection.confidence)))item.confidence=Math.min(item.confidence,Number(detection.confidence));
        items.push(item);
      }
      if(ambiguous.length)return {status:'NEEDS_CONFIRMATION',ambiguous,unresolved,items};
      if(!items.length)return {status:'UNRESOLVED',unresolved};
      const meal={id:idFactory(),userId,occurredAt,mealType,source:sanitizeSource({...source,modality:'image'}),status:'ACTIVE',items,unresolved,totals:totals(items),createdAt:now(),updatedAt:now(),audit:[]};
      await store.saveMeal(meal);return {duplicate:false,meal:clone(meal),summary:await this.summaryForMeal(meal.id)};
    },
    async summaryForMeal(id){
      const meal=await store.getMeal(id);if(!meal)return null;
      const daily=await this.dailyTotals(meal.userId,meal.occurredAt);const list=(await store.listMeals(meal.userId)).filter(m=>m.status==='ACTIVE'&&String(m.occurredAt).slice(0,10)===String(meal.occurredAt).slice(0,10)).sort((a,b)=>String(a.occurredAt).localeCompare(String(b.occurredAt)));
      const preference=await prefs(meal.userId);const index=Math.max(1,list.findIndex(m=>m.id===meal.id)+1);
      const estimate=meal.items.some(i=>i.estimated)||meal.unresolved.length>0;
      return {mealId:meal.id,kcal:meal.totals.kcal,dailyKcal:daily.kcal,estimated:estimate,unresolved:clone(meal.unresolved),coaching:shouldCoach(preference.coachingFrequency,index)?coachingText(meal):null,coachingFrequency:preference.coachingFrequency};
    },
    async dailyTotals(userId,dateOrTimestamp=now()){
      const day=String(dateOrTimestamp).slice(0,10);const meals=(await store.listMeals(userId)).filter(m=>m.status==='ACTIVE'&&String(m.occurredAt).slice(0,10)===day);return {...totals(meals.flatMap(m=>m.items)),mealCount:meals.length,date:day};
    },
    async correctMeal({userId,mealId,text}){
      const meal=await store.getMeal(mealId);if(!meal||meal.userId!==userId)throw new Error('meal not found');
      const resolution=await resolveText(text);if(resolution.ambiguous.length)return {status:'NEEDS_CONFIRMATION',ambiguous:resolution.ambiguous};if(!resolution.items.length)return {status:'UNRESOLVED',unresolved:resolution.unresolved};
      meal.audit.push({type:'CORRECTED',at:now(),previous:{items:clone(meal.items),totals:clone(meal.totals)}});meal.items=resolution.items;meal.unresolved=resolution.unresolved;meal.totals=totals(meal.items);meal.updatedAt=now();await store.saveMeal(meal);return {meal:clone(meal),summary:await this.summaryForMeal(meal.id)};
    },
    async deleteMeal({userId,mealId}){const meal=await store.getMeal(mealId);if(!meal||meal.userId!==userId)return {deleted:false};if(meal.status!=='DELETED'){meal.audit.push({type:'DELETED',at:now()});meal.status='DELETED';meal.updatedAt=now();await store.saveMeal(meal);}return {deleted:true,mealId};},
    async listMeals(userId,{date=null}={}){return (await store.listMeals(userId)).filter(m=>!date||String(m.occurredAt).slice(0,10)===date).map(clone);},
  };
}

export function formatFoodDiaryReply(result){
  if(result?.status==='NEEDS_CONFIRMATION')return 'Preciso confirmar um alimento antes de registrar.';
  if(result?.status==='UNRESOLVED')return 'Não consegui resolver os alimentos com confiança suficiente para registrar.';
  const s=result?.summary;if(!s)return 'Nada foi registrado.';
  const estimate=s.estimated?'aprox. ':'';
  let reply=`Registrado: ${estimate}${s.kcal} kcal. Hoje: ${estimate}${s.dailyKcal} kcal.`;
  if(s.coaching)reply+=` ${s.coaching}`;
  return reply;
}
