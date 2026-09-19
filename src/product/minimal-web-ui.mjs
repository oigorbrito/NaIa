function escapeHtml(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
function page(title,body){return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main>${body}</main></body></html>`;}
function statusBlock(objective){
  if(!objective)return '<p>No objective.</p>';
  const steps=(objective.steps??[]).map(step=>`<li>${escapeHtml(step.kind)} — ${escapeHtml(step.status)}${step.tool?` — ${escapeHtml(step.tool)}`:''}${step.error?` — ${escapeHtml(step.error)}`:''}</li>`).join('');
  const approvals=(objective.pendingApprovals??[]).map(row=>`<form method="post" action="/approve"><input type="hidden" name="objectiveId" value="${escapeHtml(row.objectiveId)}"><input type="hidden" name="tool" value="${escapeHtml(row.tool)}"><button type="submit">Approve ${escapeHtml(row.tool)}</button></form>`).join('');
  const confirmations=(objective.pendingConfirmations??[]).map(row=>`<form method="post" action="/confirm"><input type="hidden" name="objectiveId" value="${escapeHtml(row.objectiveId)}"><input type="hidden" name="confirmationId" value="${escapeHtml(row.confirmationId)}"><button type="submit">Confirm</button></form>`).join('');
  return `<section><h2>${escapeHtml(objective.title)}</h2><p>Status: <strong>${escapeHtml(objective.status)}</strong></p><ul>${steps}</ul>${approvals}${confirmations}<form method="post" action="/resume"><input type="hidden" name="objectiveId" value="${escapeHtml(objective.id)}"><button type="submit">Resume</button></form></section>`;
}
function historyBlock(rows=[]){return `<section><h2>History</h2><ul>${rows.map(row=>`<li><a href="/objective/${encodeURIComponent(row.id)}">${escapeHtml(row.title??row.id)}</a> — ${escapeHtml(row.status??'')}</li>`).join('')}</ul></section>`;}
function form(){return '<form method="post" action="/submit"><label>Request <input name="text" required></label><button type="submit">Send</button></form>';}
function response(status,body,headers={}){return {status,headers:{'content-type':'text/html; charset=utf-8',...headers},body};}
function parseBody(body){if(body==null)return {};if(typeof body==='object')return body;return Object.fromEntries(new URLSearchParams(String(body)));}

export function createMinimalWebUi({api}={}){
  if(!api||typeof api.submit!=='function'||typeof api.objective!=='function')throw new Error('frontend api is required');
  return {
    async handle({method='GET',path='/',body=null}={}){
      const verb=String(method).toUpperCase();
      try{
        if(verb==='GET'&&path==='/'){const history=await api.history();return response(200,page('NaIA',`${form()}${history.ok?historyBlock(history.objectives):`<p>${escapeHtml(history.error?.message)}</p>`}`));}
        if(verb==='GET'&&path==='/history'){const history=await api.history();return response(history.ok?200:500,page('NaIA history',history.ok?historyBlock(history.objectives):`<p>${escapeHtml(history.error?.message)}</p>`));}
        if(verb==='GET'&&path.startsWith('/objective/')){const id=decodeURIComponent(path.slice('/objective/'.length));const result=await api.objective(id);return response(result.ok?200:404,page('NaIA objective',result.ok?statusBlock(result.objective):`<p>${escapeHtml(result.error?.message)}</p>`));}
        if(verb==='POST'&&path==='/submit'){const input=parseBody(body);const result=await api.submit({text:input.text??'',description:input.description??''});return response(result.ok?200:400,page('NaIA',`${form()}${result.ok?statusBlock(result.objective):`<p>${escapeHtml(result.error?.message)}</p>`}`));}
        if(verb==='POST'&&path==='/approve'){const input=parseBody(body);const result=await api.approve({objectiveId:input.objectiveId,tool:input.tool});return response(result.ok?200:400,page('NaIA approval',result.ok?statusBlock(result.objective):`<p>${escapeHtml(result.error?.message)}</p>`));}
        if(verb==='POST'&&path==='/confirm'){const input=parseBody(body);const result=await api.confirm({objectiveId:input.objectiveId,confirmationId:input.confirmationId});return response(result.ok?200:400,page('NaIA confirmation',result.ok?statusBlock(result.objective):`<p>${escapeHtml(result.error?.message)}</p>`));}
        if(verb==='POST'&&path==='/resume'){const input=parseBody(body);const result=await api.resume(input.objectiveId);return response(result.ok?200:400,page('NaIA resume',result.ok?statusBlock(result.objective):`<p>${escapeHtml(result.error?.message)}</p>`));}
        return response(404,page('Not found','<p>Not found</p>'));
      }catch(error){return response(500,page('Error',`<p>${escapeHtml(error?.message??error)}</p>`));}
    },
  };
}
