function clone(value){return value==null?value:structuredClone(value);}

function providerFailure(provider,response){
  const error=new Error(provider+' request failed');
  if(response.status===401||response.status===403){error.code='AUTH_FAILED';error.retryable=false;}
  else if(response.status===429){error.code='RATE_LIMIT';error.retryable=true;}
  else if(response.status>=500){error.code='PROVIDER_UNAVAILABLE';error.retryable=true;}
  else {error.code='PROVIDER_ERROR';error.retryable=false;}
  error.status=response.status;
  return error;
}

async function postJson({provider,url,headers,body,fetchImpl}){
  const response=await fetchImpl(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
  if(!response?.ok)throw providerFailure(provider,response??{status:0});
  return response.json();
}

function toolsOf(request){
  return (request?.tools??[]).map((tool)=>({
    name:String(tool?.name??tool?.function?.name??'').trim(),
    description:tool?.description??tool?.function?.description??'',
    inputSchema:clone(tool?.inputSchema??tool?.parameters??tool?.function?.parameters??{type:'object',properties:{}}),
  })).filter((tool)=>tool.name);
}

function asMessages(request){
  if(Array.isArray(request?.messages)&&request.messages.length)return clone(request.messages);
  const input=request?.input;
  if(Array.isArray(input))return clone(input);
  return [{role:'user',content:input==null?'':String(input)}];
}

function normalizeOpenAIUsage(usage){
  if(!usage)return null;
  return {inputTokens:usage.input_tokens??usage.prompt_tokens??null,outputTokens:usage.output_tokens??usage.completion_tokens??null,totalTokens:usage.total_tokens??null};
}

function textFromResponses(raw){
  if(typeof raw?.output_text==='string')return raw.output_text;
  return (raw?.output??[]).filter((item)=>item?.type==='message').flatMap((item)=>item.content??[]).filter((part)=>part?.type==='output_text').map((part)=>part.text??'').join('');
}

function callsFromResponses(raw){
  return (raw?.output??[]).filter((item)=>item?.type==='function_call').map((item,index)=>({
    id:String(item.call_id??item.id??'tool-call-'+(index+1)),
    function:{name:item.name,arguments:item.arguments??'{}'},
  }));
}

function responsesRequest(model,request){
  const tools=toolsOf(request);
  return {
    model,
    input:request?.input??request?.messages??'',
    ...(request?.system?{instructions:request.system}:{}),
    ...(tools.length?{tools:tools.map((tool)=>({type:'function',name:tool.name,description:tool.description,parameters:tool.inputSchema}))}:{}),
    ...(request?.maxOutputTokens?{max_output_tokens:request.maxOutputTokens}:{}),
    ...(request?.temperature!=null?{temperature:request.temperature}:{}),
  };
}

function createResponsesAdapter({provider,apiKey,baseUrl,fetchImpl=globalThis.fetch}){
  if(!apiKey)throw new Error(provider+' apiKey is required');
  if(typeof fetchImpl!=='function')throw new Error('fetch implementation is required');
  return {
    provider,
    async complete({model,request}){
      const raw=await postJson({
        provider,
        url:baseUrl.replace(/\/$/,'')+'/responses',
        headers:{authorization:'Bearer '+apiKey},
        body:responsesRequest(model,request),
        fetchImpl,
      });
      return {model:raw?.model??model,output:textFromResponses(raw),toolCalls:callsFromResponses(raw),usage:normalizeOpenAIUsage(raw?.usage)};
    },
  };
}

export function createOpenAIModelAdapter({apiKey,baseUrl='https://api.openai.com/v1',fetchImpl}={}){
  return createResponsesAdapter({provider:'openai',apiKey,baseUrl,fetchImpl});
}

export function createDeepSeekModelAdapter({apiKey,baseUrl='https://api.deepseek.com',fetchImpl}={}){
  return createResponsesAdapter({provider:'deepseek',apiKey,baseUrl,fetchImpl});
}

export function createAnthropicModelAdapter({apiKey,baseUrl='https://api.anthropic.com',apiVersion='2023-06-01',fetchImpl=globalThis.fetch}={}){
  if(!apiKey)throw new Error('anthropic apiKey is required');
  if(typeof fetchImpl!=='function')throw new Error('fetch implementation is required');
  return {
    provider:'anthropic',
    async complete({model,request}){
      const tools=toolsOf(request);
      const raw=await postJson({
        provider:'anthropic',
        url:baseUrl.replace(/\/$/,'')+'/v1/messages',
        headers:{'x-api-key':apiKey,'anthropic-version':apiVersion},
        body:{
          model,
          max_tokens:request?.maxOutputTokens??4096,
          messages:asMessages(request).filter((message)=>message.role!=='system'),
          ...(request?.system?{system:request.system}:{}),
          ...(tools.length?{tools:tools.map((tool)=>({name:tool.name,description:tool.description,input_schema:tool.inputSchema}))}:{}),
          ...(request?.temperature!=null?{temperature:request.temperature}:{}),
        },
        fetchImpl,
      });
      const content=raw?.content??[];
      return {
        model:raw?.model??model,
        output:content.filter((part)=>part?.type==='text').map((part)=>part.text??'').join(''),
        toolCalls:content.filter((part)=>part?.type==='tool_use').map((part,index)=>({id:String(part.id??'tool-call-'+(index+1)),name:part.name,input:clone(part.input??{})})),
        usage:raw?.usage?{inputTokens:raw.usage.input_tokens??null,outputTokens:raw.usage.output_tokens??null,totalTokens:null}:null,
      };
    },
  };
}

function geminiContents(request){
  return asMessages(request).filter((message)=>message.role!=='system').map((message)=>({
    role:message.role==='assistant'?'model':'user',
    parts:Array.isArray(message.content)?clone(message.content):[{text:String(message.content??'')}],
  }));
}

export function createGeminiModelAdapter({apiKey,baseUrl='https://generativelanguage.googleapis.com',fetchImpl=globalThis.fetch}={}){
  if(!apiKey)throw new Error('gemini apiKey is required');
  if(typeof fetchImpl!=='function')throw new Error('fetch implementation is required');
  return {
    provider:'gemini',
    async complete({model,request}){
      const tools=toolsOf(request);
      const raw=await postJson({
        provider:'gemini',
        url:baseUrl.replace(/\/$/,'')+'/v1beta/models/'+encodeURIComponent(model)+':generateContent',
        headers:{'x-goog-api-key':apiKey},
        body:{
          contents:geminiContents(request),
          ...(request?.system?{systemInstruction:{parts:[{text:request.system}]}}:{}),
          ...(tools.length?{tools:[{functionDeclarations:tools.map((tool)=>({name:tool.name,description:tool.description,parameters:tool.inputSchema}))}]}:{}),
          ...(request?.maxOutputTokens||request?.temperature!=null?{generationConfig:{
            ...(request?.maxOutputTokens?{maxOutputTokens:request.maxOutputTokens}:{}),
            ...(request?.temperature!=null?{temperature:request.temperature}:{}),
          }}:{}),
        },
        fetchImpl,
      });
      const parts=raw?.candidates?.[0]?.content?.parts??[];
      return {
        model:raw?.modelVersion??model,
        output:parts.filter((part)=>typeof part?.text==='string').map((part)=>part.text).join(''),
        toolCalls:parts.filter((part)=>part?.functionCall?.name).map((part,index)=>({id:String(part.functionCall.id??'tool-call-'+(index+1)),name:part.functionCall.name,input:clone(part.functionCall.args??{})})),
        usage:raw?.usageMetadata?{
          inputTokens:raw.usageMetadata.promptTokenCount??null,
          outputTokens:raw.usageMetadata.candidatesTokenCount??null,
          totalTokens:raw.usageMetadata.totalTokenCount??null,
        }:null,
      };
    },
  };
}
