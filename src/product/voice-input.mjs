import { randomUUID } from 'node:crypto';

function clone(value){ return value==null?value:structuredClone(value); }

export function createMemoryVoiceStore(){
  const rows=new Map();
  return {
    async save(row){ rows.set(row.id,clone(row)); return clone(row); },
    async get(id){ const row=rows.get(id); return row?clone(row):null; },
  };
}

export function createFixtureTranscriptionProvider({name='fixture-stt',supportedMimeTypes=['audio/ogg','audio/mpeg','audio/wav'],result=null,fail=null}={}){
  return {
    name,
    supports(mimeType){ return supportedMimeTypes.includes(String(mimeType).toLowerCase()); },
    async transcribe(input){
      if(!this.supports(input.mimeType)){ const e=new Error('unsupported audio format'); e.code='UNSUPPORTED_AUDIO'; throw e; }
      if(fail){ const e=new Error(fail.message??'transcription failed'); e.code=fail.code??'TRANSCRIPTION_FAILED'; e.retryable=Boolean(fail.retryable); throw e; }
      const value=typeof result==='function'?await result(clone(input)):result;
      return clone(value??{text:'',language:'pt-BR',confidence:0});
    },
  };
}

export function createVoiceInputService({
  transcriber,naia,store=createMemoryVoiceStore(),minConfidence=0.75,retentionPolicy='REFERENCE_ONLY',idFactory=randomUUID,now=()=>new Date().toISOString(),
}={}){
  if(!transcriber||typeof transcriber.transcribe!=='function') throw new Error('transcription provider is required');
  if(!naia||typeof naia.pursue!=='function') throw new Error('NaIA service is required');
  if(!['REFERENCE_ONLY','NONE'].includes(retentionPolicy)) throw new Error('unsupported audio retention policy');

  async function persist({audioRef,mimeType,providerResult,status}){
    const confidence=Number(providerResult?.confidence);
    const row={
      id:idFactory(),
      status,
      audioRef:retentionPolicy==='REFERENCE_ONLY'?String(audioRef):null,
      mimeType:String(mimeType).toLowerCase(),
      transcript:{
        text:String(providerResult?.text??'').trim(),
        language:providerResult?.language??null,
        confidence:Number.isFinite(confidence)?confidence:null,
        segments:clone(providerResult?.segments??[]),
        provenance:{provider:transcriber.name??'unknown',providerTranscriptId:providerResult?.id??null},
      },
      objectiveId:null,
      evidence:[{type:'VOICE_TRANSCRIBED',at:now(),provider:transcriber.name??'unknown',confidence:Number.isFinite(confidence)?confidence:null,language:providerResult?.language??null}],
      createdAt:now(),updatedAt:now(),
    };
    await store.save(row); return row;
  }

  return {
    async submit({audioRef,mimeType,languageHint=null}){
      if(!audioRef||!mimeType) throw new Error('audioRef and mimeType are required');
      if(typeof transcriber.supports==='function'&&!transcriber.supports(String(mimeType).toLowerCase())){
        return {status:'UNSUPPORTED_AUDIO',objective:null,error:{code:'UNSUPPORTED_AUDIO',retryable:false}};
      }
      let providerResult;
      try{ providerResult=await transcriber.transcribe({audioRef,mimeType:String(mimeType).toLowerCase(),languageHint}); }
      catch(error){ return {status:'TRANSCRIPTION_FAILED',objective:null,error:{code:error?.code??'TRANSCRIPTION_FAILED',message:error?.message??String(error),retryable:Boolean(error?.retryable)}}; }
      const confidence=Number(providerResult?.confidence);
      const text=String(providerResult?.text??'').trim();
      if(!text){ const row=await persist({audioRef,mimeType,providerResult,status:'TRANSCRIPTION_EMPTY'}); return {status:row.status,submission:row,objective:null}; }
      if(!Number.isFinite(confidence)||confidence<minConfidence){
        const row=await persist({audioRef,mimeType,providerResult,status:'NEEDS_TRANSCRIPT_CONFIRMATION'});
        row.evidence.push({type:'VOICE_TRANSCRIPT_REVIEW_REQUIRED',at:now(),threshold:minConfidence}); await store.save(row);
        return {status:row.status,submission:clone(row),objective:null};
      }
      const row=await persist({audioRef,mimeType,providerResult,status:'TRANSCRIBED'});
      const objective=await naia.pursue({title:text,description:`Voice transcript (${row.transcript.language??'unknown'}, confidence=${row.transcript.confidence??'unknown'}, provider=${row.transcript.provenance.provider})`});
      row.status='SUBMITTED'; row.objectiveId=objective.objective.id; row.updatedAt=now(); row.evidence.push({type:'VOICE_OBJECTIVE_SUBMITTED',at:row.updatedAt,objectiveId:row.objectiveId}); await store.save(row);
      return {status:'SUBMITTED',submission:clone(row),objective};
    },

    async confirmTranscript(submissionId,{text=null}={}){
      const row=await store.get(submissionId); if(!row) throw new Error('voice submission not found: '+submissionId);
      if(row.status!=='NEEDS_TRANSCRIPT_CONFIRMATION'){ const e=new Error('voice submission is not awaiting transcript confirmation'); e.code='INVALID_VOICE_STATE'; throw e; }
      const finalText=String(text??row.transcript.text??'').trim(); if(!finalText) throw new Error('confirmed transcript text is required');
      row.transcript.confirmedText=finalText; row.transcript.confirmedAt=now();
      const objective=await naia.pursue({title:finalText,description:`User-confirmed voice transcript (provider=${row.transcript.provenance.provider})`});
      row.status='SUBMITTED'; row.objectiveId=objective.objective.id; row.updatedAt=now(); row.evidence.push({type:'VOICE_OBJECTIVE_SUBMITTED',at:row.updatedAt,objectiveId:row.objectiveId,userConfirmed:true}); await store.save(row);
      return {status:'SUBMITTED',submission:clone(row),objective};
    },

    async get(id){ const row=await store.get(id); if(!row) throw new Error('voice submission not found: '+id); return row; },
  };
}
