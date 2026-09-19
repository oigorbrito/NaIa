function clone(v){return v==null?v:structuredClone(v);}

export function createMemoryMobileCache(){
  let snapshot=null;
  return {
    async save(value){snapshot=clone(value);return clone(snapshot);},
    async get(){return clone(snapshot);},
    async clear(){snapshot=null;},
  };
}

export function parseNaiaDeepLink(url){
  const value=String(url??'').trim();
  if(!value.startsWith('naia://')){const e=new Error('unsupported deep link');e.code='INVALID_DEEP_LINK';throw e;}
  const parsed=new URL(value);
  const kind=parsed.hostname;
  const id=parsed.pathname.replace(/^\/+/, '');
  if(!['objective','approval','confirmation'].includes(kind)||!id){const e=new Error('invalid NaIA deep link');e.code='INVALID_DEEP_LINK';throw e;}
  return {kind,id,tool:parsed.searchParams.get('tool'),confirmationId:parsed.searchParams.get('confirmationId')};
}

export function createMobileClient({frontendApi,platform,cache=createMemoryMobileCache(),now=()=>new Date().toISOString()}={}){
  if(!frontendApi)throw new Error('frontend API is required');
  if(!platform||typeof platform.invoke!=='function'||typeof platform.capabilities!=='function')throw new Error('platform runtime is required');
  let online=true;
  let session={signedIn:false,userId:null,signedInAt:null};

  function offlineError(){const e=new Error('mobile client is offline/read-only');e.code='OFFLINE_READ_ONLY';e.retryable=true;return e;}
  async function requireOnline(){if(!online)throw offlineError();}
  async function secure(operation,key,value=null){return platform.invoke('secure.credentials',{operation,key,...(value!==null?{value}:{})});}

  return {
    platform:platform.platform,
    capabilities(){return platform.capabilities();},
    invokeDevice(capability,input={}){return platform.invoke(capability,input);},
    setOnline(value){online=Boolean(value);return online;},
    isOnline(){return online;},

    async signIn({userId,sessionToken}){
      if(!userId||!sessionToken)throw new Error('userId and sessionToken are required');
      await requireOnline();
      await secure('write','naia.session.token',sessionToken);
      session={signedIn:true,userId:String(userId),signedInAt:now()};
      return clone(session);
    },

    async signOut(){
      try{await secure('delete','naia.session.token');}catch(error){if(error?.code!=='PERMISSION_REQUIRED'&&error?.code!=='CAPABILITY_UNAVAILABLE')throw error;}
      session={signedIn:false,userId:null,signedInAt:null};
      await cache.clear();
      return clone(session);
    },

    session(){return clone(session);},

    async bootstrap(){
      if(!online){
        const cached=await cache.get();
        if(!cached)return {ok:false,offline:true,error:{code:'OFFLINE_NO_CACHE',retryable:true}};
        return {ok:true,offline:true,cached:true,shell:cached};
      }
      const shell=await frontendApi.shell();
      if(shell.ok)await cache.save(shell);
      return {ok:shell.ok,offline:false,cached:false,shell};
    },

    async submit(text){await requireOnline();return frontendApi.submit({text});},
    async objective(id){
      if(online)return frontendApi.objective(id);
      const cached=await cache.get();
      const row=cached?.surfaces?.history?.objectives?.find?.((item)=>item.id===id)??null;
      return row?{ok:true,offline:true,objective:clone(row)}:{ok:false,offline:true,error:{code:'NOT_AVAILABLE_OFFLINE',retryable:true}};
    },
    async approvals(){
      if(online)return frontendApi.approvals();
      const cached=await cache.get();
      const approvals=cached?.surfaces?.approvals;
      return approvals?{...clone(approvals),offline:true}:{ok:false,offline:true,error:{code:'NOT_AVAILABLE_OFFLINE',retryable:true}};
    },
    async approve(args){await requireOnline();return frontendApi.approve(args);},
    async confirm(args){await requireOnline();return frontendApi.confirm(args);},
    async automations(){
      if(online)return frontendApi.automations();
      const cached=await cache.get();
      const items=cached?.surfaces?.automations;
      return items?{...clone(items),offline:true}:{ok:false,offline:true,error:{code:'NOT_AVAILABLE_OFFLINE',retryable:true}};
    },
    async cancelAutomation(id){await requireOnline();return frontendApi.cancelAutomation(id);},

    async history(){
      if(online)return frontendApi.history();
      const cached=await cache.get();
      const value=cached?.surfaces?.history;
      return value?{...clone(value),offline:true}:{ok:false,offline:true,error:{code:'NOT_AVAILABLE_OFFLINE',retryable:true}};
    },

    async connectors(){
      if(online)return frontendApi.connectorState();
      const cached=await cache.get();
      const value=cached?.surfaces?.connectors;
      return value?{...clone(value),offline:true}:{ok:false,offline:true,error:{code:'NOT_AVAILABLE_OFFLINE',retryable:true}};
    },

    async premiumState(){
      if(online)return frontendApi.premiumState();
      const cached=await cache.get();
      const value=cached?.surfaces?.premium;
      return value?{...clone(value),offline:true}:{ok:false,offline:true,error:{code:'NOT_AVAILABLE_OFFLINE',retryable:true}};
    },

    async media(){
      if(online)return frontendApi.mediaState();
      const cached=await cache.get();
      const value=cached?.surfaces?.media;
      return value?{...clone(value),offline:true}:{ok:false,offline:true,error:{code:'NOT_AVAILABLE_OFFLINE',retryable:true}};
    },

    async scheduleBackground({id,task}){
      return platform.invoke('background.schedule',{operation:'schedule',id,task:clone(task)});
    },
    async cancelBackground(id){
      return platform.invoke('background.schedule',{operation:'cancel',id});
    },

    async showNotification({title,body,context}){
      return platform.invoke('notifications.show',{operation:'show',title,body,context:clone(context??null)});
    },

    async notifyObjective({objectiveId,title='NaIA',body='Objective updated'}){
      return this.showNotification({title,body,context:{deepLink:`naia://objective/${encodeURIComponent(objectiveId)}`,objectiveId}});
    },
    async notifyApproval({objectiveId,tool,title='NaIA approval required',body='Open to review'}){
      const deepLink=`naia://approval/${encodeURIComponent(objectiveId)}?tool=${encodeURIComponent(tool??'')}`;
      return this.showNotification({title,body,context:{deepLink,objectiveId,tool:tool??null}});
    },
    async notifyConfirmation({objectiveId,confirmationId,title='NaIA confirmation required',body='Open to choose'}){
      const deepLink=`naia://confirmation/${encodeURIComponent(objectiveId)}?confirmationId=${encodeURIComponent(confirmationId??'')}`;
      return this.showNotification({title,body,context:{deepLink,objectiveId,confirmationId:confirmationId??null}});
    },

    async openDeepLink(url){
      const link=parseNaiaDeepLink(url);
      if(link.kind==='objective')return {route:'objective',objectiveId:link.id};
      if(link.kind==='approval'){
        const state=await this.approvals();
        return {route:'approval',objectiveId:link.id,tool:link.tool,context:state};
      }
      const state=await this.approvals();
      return {route:'confirmation',objectiveId:link.id,confirmationId:link.confirmationId,context:state};
    },
  };
}
