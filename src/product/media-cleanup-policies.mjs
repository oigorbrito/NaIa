import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function clone(v){return v==null?v:structuredClone(v);}
function norm(v){return String(v??'').trim().toLowerCase();}

export function createMemoryMediaCleanupPolicyStore(){
  const policies=new Map();const runs=new Map();
  return {
    async savePolicy(row){policies.set(row.id,clone(row));return clone(row);},
    async getPolicy(id){const row=policies.get(String(id));return row?clone(row):null;},
    async listPolicies(userId){return [...policies.values()].filter(row=>!userId||row.userId===userId).map(clone);},
    async deletePolicy(id){return policies.delete(String(id));},
    async saveRun(row){runs.set(row.id,clone(row));return clone(row);},
    async listRuns(policyId){return [...runs.values()].filter(row=>row.policyId===policyId).map(clone);},
  };
}

async function readPolicyJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error?.code==='ENOENT')return {policies:{},runs:{}};throw error;}}
async function writePolicyJsonAtomic(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.${process.pid}.tmp`;await writeFile(temp,`${JSON.stringify(value,null,2)}\n`,'utf8');await rename(temp,path);}

export function createFileMediaCleanupPolicyStore({rootDir='.naia'}={}){
  const path=join(rootDir,'media-cleanup-policies.json');let chain=Promise.resolve();
  async function mutate(fn){chain=chain.catch(()=>{}).then(async()=>{const data=await readPolicyJson(path);const result=await fn(data);await writePolicyJsonAtomic(path,data);return clone(result);});return chain;}
  return {
    path,
    async savePolicy(row){return mutate(data=>{data.policies[row.id]=clone(row);return row;});},
    async getPolicy(id){const data=await readPolicyJson(path);return data.policies?.[String(id)]?clone(data.policies[String(id)]):null;},
    async listPolicies(userId){const data=await readPolicyJson(path);return Object.values(data.policies??{}).filter(row=>!userId||row.userId===userId).map(clone);},
    async deletePolicy(id){return mutate(data=>{const key=String(id);const existed=Object.prototype.hasOwnProperty.call(data.policies,key);delete data.policies[key];return existed;});},
    async saveRun(row){return mutate(data=>{data.runs[row.id]=clone(row);return row;});},
    async listRuns(policyId){const data=await readPolicyJson(path);return Object.values(data.runs??{}).filter(row=>row.policyId===policyId).map(clone);},
  };
}

function matchesPolicy(item,filters={},asOf){
  if(filters.sourceType&&norm(item.sourceType)!==norm(filters.sourceType))return false;
  if(filters.category){const labels=(item.categories??item.labels??[]).map(v=>norm(typeof v==='string'?v:v?.category));if(!labels.includes(norm(filters.category)))return false;}
  if(filters.duplicateKind){const kinds=(item.duplicateKinds??[]).map(norm);if(!kinds.includes(norm(filters.duplicateKind)))return false;}
  if(Number.isFinite(Number(filters.minSizeBytes))&&Number(item.sizeBytes??0)<Number(filters.minSizeBytes))return false;
  if(Number.isFinite(Number(filters.minAgeDays))){const created=new Date(item.createdAt??item.modifiedAt??0).getTime();const now=new Date(asOf).getTime();if(!Number.isFinite(created)||!Number.isFinite(now)||(now-created)<Number(filters.minAgeDays)*86400000)return false;}
  return true;
}

export function createMediaCleanupPolicyService({store=createMemoryMediaCleanupPolicyStore(),automationService,inventory,cleanupService,idFactory=randomUUID,now=()=>new Date().toISOString()}={}){
  if(!automationService||typeof automationService.create!=='function')throw new Error('automation service is required');
  if(!inventory||typeof inventory.list!=='function')throw new Error('media inventory is required');
  if(!cleanupService||typeof cleanupService.prepare!=='function')throw new Error('media cleanup service is required');
  async function requirePolicy(id){const row=await store.getPolicy(id);if(!row)throw new Error('cleanup policy not found: '+id);return row;}
  return {
    async create({userId,name,schedule,timezone='UTC',filters={},mode='DRY_RUN',preferTrash=true}){
      if(!userId||!String(name??'').trim())throw new Error('userId and policy name are required');
      const normalizedMode=String(mode).toUpperCase();if(!['DRY_RUN','REVIEW'].includes(normalizedMode))throw new Error('unsupported cleanup policy mode');
      const id=idFactory();
      const automation=await automationService.create({
        userId,name:`Media cleanup: ${String(name).trim()}`,enabled:true,
        trigger:{kind:'SCHEDULE',schedule:String(schedule),timezone:String(timezone)},
        action:{tool:'media.cleanup.policy.evaluate',input:{policyId:id},risk:'READ_ONLY',capability:'media.cleanup.policy'},
        metadata:{mediaCleanupPolicyId:id},
      });
      const row={id,userId,name:String(name).trim(),schedule:String(schedule),timezone:String(timezone),filters:clone(filters),mode:normalizedMode,preferTrash:Boolean(preferTrash),status:'ACTIVE',automationId:automation.id,createdAt:now(),updatedAt:now()};
      await store.savePolicy(row);return clone(row);
    },
    async evaluate(policyId,{occurrenceKey=null}={}){
      const policy=await requirePolicy(policyId);
      if(policy.status!=='ACTIVE')return {status:policy.status,policyId,candidates:[]};
      const rows=await inventory.list();const candidates=(rows??[]).filter(item=>matchesPolicy(item,policy.filters,now())).map(item=>clone(item));
      const run={id:idFactory(),policyId:policy.id,userId:policy.userId,occurrenceKey,mode:policy.mode,status:'DRY_RUN',candidateIds:candidates.map(item=>item.id),cleanupActionId:null,error:null,createdAt:now(),updatedAt:now()};
      if(policy.mode==='REVIEW'&&candidates.length){
        try{const action=await cleanupService.prepare({userId:policy.userId,items:candidates,preferTrash:policy.preferTrash,selectionReason:`policy:${policy.id}`});run.status='AWAITING_REVIEW';run.cleanupActionId=action.id;}
        catch(error){run.status='BLOCKED';run.error={code:error?.code??'POLICY_PREPARE_FAILED',reasons:clone(error?.reasons??[])};}
      }
      await store.saveRun(run);return {status:run.status,policy:clone(policy),candidates,run:clone(run)};
    },
    async pause(id){const row=await requirePolicy(id);row.status='PAUSED';row.updatedAt=now();await store.savePolicy(row);await automationService.setEnabled(row.automationId,false);return clone(row);},
    async resume(id){const row=await requirePolicy(id);if(row.status==='DELETED')throw new Error('deleted policy cannot resume');row.status='ACTIVE';row.updatedAt=now();await store.savePolicy(row);await automationService.setEnabled(row.automationId,true);return clone(row);},
    async delete(id){const row=await requirePolicy(id);await automationService.delete(row.automationId);row.status='DELETED';row.updatedAt=now();await store.savePolicy(row);return {deleted:true,policy:clone(row)};},
    async get(id){return requirePolicy(id);},
    async list(userId){return store.listPolicies(userId);},
    async runs(id){return store.listRuns(id);},
  };
}

export function registerMediaCleanupPolicyCapability(naia,{service}={}){
  if(!naia||typeof naia.registerCapability!=='function')throw new Error('NaIA capability registration is required');
  if(!service)throw new Error('media cleanup policy service is required');
  return naia.registerCapability({
    name:'media.cleanup.policy.evaluate',
    tool:{risk:'READ_ONLY',capability:'media.cleanup.policy',description:'Evaluates one scheduled media cleanup policy without deleting media',async run(input){return service.evaluate(input.policyId,{occurrenceKey:input.triggerPayload?.occurrenceKey??null});}},
  });
}
