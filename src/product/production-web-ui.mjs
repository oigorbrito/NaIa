function esc(v){return String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
function response(status,body,headers={}){return {status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store',...headers},body};}
function parseBody(body){if(body==null)return {};if(typeof body==='object')return body;return Object.fromEntries(new URLSearchParams(String(body)));}
function layout({title='NaIA',active='chat',body='',state='online'}={}){
  const nav=['chat','objectives','approvals','automations','connectors','history','media','settings'];
  const links=nav.map(item=>`<a data-nav="${item}" class="${active===item?'active':''}"${active===item?' aria-current="page"':''} href="/surface/${item}">${esc(item)}</a>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
  :root{font-family:system-ui,sans-serif;color-scheme:light dark}*{box-sizing:border-box}body{margin:0;background:Canvas;color:CanvasText}.app{min-height:100vh;display:grid;grid-template-columns:220px 1fr}.nav{padding:16px;border-right:1px solid color-mix(in srgb,CanvasText 18%,transparent);display:flex;flex-direction:column;gap:8px}.nav a{padding:10px 12px;border-radius:8px;text-decoration:none;color:inherit}.nav a.active{background:color-mix(in srgb,Highlight 18%,transparent)}main{padding:20px;max-width:1100px;width:100%}.card{border:1px solid color-mix(in srgb,CanvasText 18%,transparent);border-radius:12px;padding:14px;margin:0 0 14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}button,input{font:inherit;padding:10px}form.inline{display:inline-flex;gap:8px;align-items:center}.muted{opacity:.72}.error{border-left:4px solid currentColor}.badge{display:inline-block;padding:2px 8px;border-radius:999px;border:1px solid currentColor;font-size:.8rem}.offline{padding:10px;border:1px dashed currentColor;margin-bottom:12px}
  @media (max-width:720px){.app{grid-template-columns:1fr}.nav{position:sticky;top:0;z-index:2;border-right:0;border-bottom:1px solid color-mix(in srgb,CanvasText 18%,transparent);flex-direction:row;overflow:auto;background:Canvas}.nav a{white-space:nowrap}main{padding:14px}}
  </style></head><body data-app-state="${esc(state)}"><div class="app"><nav class="nav" aria-label="Main navigation">${links}</nav><main>${body}</main></div></body></html>`;
}
function objectiveCard(row={}){
  return `<section class="card"><h3>${esc(row.title??row.id)}</h3><p><span class="badge">${esc(row.status??'UNKNOWN')}</span></p><a href="/objective/${encodeURIComponent(row.id)}">Open</a></section>`;
}
function approvalsView(data={}){
  const approvals=(data.approvals??[]).map(item=>`<section class="card"><p>${esc(item.tool)} · ${esc(item.risk)}</p><form method="post" action="/approve"><input type="hidden" name="objectiveId" value="${esc(item.objectiveId)}"><input type="hidden" name="tool" value="${esc(item.tool)}"><button>Approve</button></form></section>`).join('');
  const confirmations=(data.confirmations??[]).map(item=>`<section class="card"><p>Confirmation ${esc(item.confirmationId)}</p><form method="post" action="/confirm"><input type="hidden" name="objectiveId" value="${esc(item.objectiveId)}"><input type="hidden" name="confirmationId" value="${esc(item.confirmationId)}"><button>Confirm</button></form></section>`).join('');
  return `<h1>Approvals</h1>${approvals||'<p class="muted">No pending approvals.</p>'}${confirmations}`;
}
function automationsView(data={}){return `<h1>Automations</h1>${data.available===false?'<p class="muted">Automation service unavailable.</p>':(data.items??[]).map(item=>`<section class="card"><strong>${esc(item.title??item.name??item.id)}</strong><p>${esc(item.userState??item.status??'')}</p><form method="post" action="/automation/cancel"><input type="hidden" name="id" value="${esc(item.id)}"><button>Cancel</button></form></section>`).join('')||'<p class="muted">No automations.</p>'}`;}
function connectorsView(data={}){return `<h1>Connectors</h1>${data.available===false?'<p class="muted">Connector service unavailable.</p>':(data.connectors??[]).map(item=>`<section class="card"><strong>${esc(item.provider??item.kind??item.id)}</strong><p>${esc(item.state??'')}</p></section>`).join('')||'<p class="muted">No connectors.</p>'}`;}
function mediaView(data={}){return `<h1>Media</h1>${data.available===false?'<p class="muted">Media inventory unavailable.</p>':`<div class="grid">${(data.items??[]).map(item=>`<section class="card"><strong>${esc(item.displayName??item.id)}</strong><p>${esc(item.mediaType??item.fileKind??item.mimeType??'')}</p><p class="muted">${esc(item.sourceType??'device')}</p></section>`).join('')}</div>`}`;}
function settingsView(data={}){const plan=data.plan??null;return `<h1>Settings</h1>${data.available===false?'<p class="muted">Premium state unavailable.</p>':`<section class="card"><h2>Plan ${esc(plan?.id??'')}</h2><p>${esc(plan?.billingState??'')}</p><div class="grid">${(data.usage??[]).map(u=>`<div><strong>${esc(u.metric)}</strong><p>${esc(u.used)} / ${esc(u.limit??'∞')}</p></div>`).join('')}</div></section>`}`;}
function historyView(history={},advanced={}){const rows=advanced.available?(advanced.items??[]):(history.objectives??[]);return `<h1>History</h1>${rows.map(objectiveCard).join('')||'<p class="muted">No history.</p>'}`;}
function chatView(history={}){return `<h1>NaIA</h1><form method="post" action="/submit" class="card"><label>Request<br><input name="text" required style="width:100%"></label><p><button>Send</button></p></form><h2>Recent objectives</h2><div class="grid">${(history.objectives??[]).slice(0,8).map(objectiveCard).join('')}</div>`;}
function objectiveView(o={}){return `<h1>${esc(o.title??o.id)}</h1><p><span class="badge">${esc(o.status??'')}</span></p><section class="card"><h2>Progress</h2><ol>${(o.steps??[]).map(s=>`<li>${esc(s.kind)} · ${esc(s.status)}${s.tool?` · ${esc(s.tool)}`:''}${s.error?` · ${esc(s.error)}`:''}</li>`).join('')}</ol></section><form method="post" action="/resume"><input type="hidden" name="objectiveId" value="${esc(o.id)}"><button>Retry / Resume</button></form>`;}

export function createProductionWebUi({api}={}){
  if(!api||typeof api.shell!=='function')throw new Error('frontend api is required');
  async function shellSafe(){
    try{const data=await api.shell();return data?.ok===false?{ok:false,data,error:{message:'One or more frontend surfaces failed',retryable:true}}:{ok:true,data};}
    catch(error){return {ok:false,error:{message:error?.message??String(error),retryable:true}};}
  }
  return {
    async handle({method='GET',path='/',body=null}={}){
      const verb=String(method).toUpperCase();
      try{
        if(verb==='GET'&&(path==='/'||path.startsWith('/surface/'))){
          const active=path==='/'?'chat':decodeURIComponent(path.slice('/surface/'.length));
          const shell=await shellSafe();
          if(!shell.ok)return response(503,layout({title:'NaIA offline',active, state:'offline',body:`<div class="offline error"><strong>Offline / degraded</strong><p>${esc(shell.error?.message)}</p><a href="${esc(path)}">Retry</a></div>`}));
          const s=shell.data.surfaces??{};let view;
          if(active==='chat'||active==='objectives')view=chatView(s.history??{});
          else if(active==='approvals')view=approvalsView(s.approvals??{});
          else if(active==='automations')view=automationsView(s.automations??{});
          else if(active==='connectors')view=connectorsView(s.connectors??{});
          else if(active==='history')view=historyView(s.history??{},s.advancedHistory??{});
          else if(active==='media')view=mediaView(s.media??{});
          else if(active==='settings')view=settingsView(s.premium??{});
          else return response(404,layout({title:'Not found',active:'chat',body:'<h1>Not found</h1>'}));
          return response(200,layout({title:`NaIA · ${active}`,active,body:view}));
        }
        if(verb==='GET'&&path.startsWith('/objective/')){const id=decodeURIComponent(path.slice('/objective/'.length));const result=await api.objective(id);return response(result.ok?200:404,layout({title:'Objective',active:'objectives',body:result.ok?objectiveView(result.objective):`<div class="error">${esc(result.error?.message)}</div>`}));}
        const input=parseBody(body);
        if(verb==='POST'&&path==='/submit'){const r=await api.submit({text:input.text??'',description:input.description??''});return response(r.ok?200:400,layout({title:'NaIA',active:'chat',body:r.ok?objectiveView(r.objective):`<div class="error">${esc(r.error?.message)}</div>`}));}
        if(verb==='POST'&&path==='/approve'){const r=await api.approve({objectiveId:input.objectiveId,tool:input.tool});return response(r.ok?200:400,layout({title:'Approval',active:'approvals',body:r.ok?objectiveView(r.objective):`<div class="error">${esc(r.error?.message)}</div>`}));}
        if(verb==='POST'&&path==='/confirm'){const r=await api.confirm({objectiveId:input.objectiveId,confirmationId:input.confirmationId});return response(r.ok?200:400,layout({title:'Confirmation',active:'approvals',body:r.ok?objectiveView(r.objective):`<div class="error">${esc(r.error?.message)}</div>`}));}
        if(verb==='POST'&&path==='/resume'){const r=await api.resume(input.objectiveId);return response(r.ok?200:400,layout({title:'Resume',active:'objectives',body:r.ok?objectiveView(r.objective):`<div class="error">${esc(r.error?.message)}</div>`}));}
        if(verb==='POST'&&path==='/automation/cancel'){const r=await api.cancelAutomation(input.id);return response(r.ok?200:400,layout({title:'Automations',active:'automations',body:r.ok?'<p>Automation cancelled.</p>':`<div class="error">${esc(r.error?.message)}</div>`}));}
        return response(404,layout({title:'Not found',active:'chat',body:'<h1>Not found</h1>'}));
      }catch(error){return response(500,layout({title:'Error',active:'chat',body:`<div class="error"><strong>Error</strong><p>${esc(error?.message??error)}</p><a href="${esc(path)}">Retry</a></div>`}));}
    },
  };
}
