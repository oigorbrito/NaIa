import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAnthropicModelAdapter,
  createDeepSeekModelAdapter,
  createGeminiModelAdapter,
  createOpenAIModelAdapter,
} from '../../src/product/model-providers.mjs';
import { createModelRegistry, createModelRouter } from '../../src/product/model-engine.mjs';

function fakeFetch(responseBody,{status=200,onRequest=()=>{}}={}){
  return async (url,options)=>{
    onRequest(url,options);
    return {ok:status>=200&&status<300,status,async json(){return structuredClone(responseBody);}};
  };
}

test('OpenAI Responses adapter maps provider-neutral request and normalizes text/tools/usage',async()=>{
  let seen;
  const adapter=createOpenAIModelAdapter({
    apiKey:'oa-secret',
    fetchImpl:fakeFetch({
      model:'gpt-live-alias',
      output:[
        {type:'message',content:[{type:'output_text',text:'hello'}]},
        {type:'function_call',call_id:'call-1',name:'calendar.list',arguments:'{"from":"today"}'},
      ],
      usage:{input_tokens:7,output_tokens:3,total_tokens:10},
    },{onRequest:(url,options)=>{seen={url,options};}}),
  });
  const result=await adapter.complete({model:'configured-model',request:{
    input:'hi',
    system:'be concise',
    maxOutputTokens:123,
    tools:[{name:'calendar.list',description:'List calendar',inputSchema:{type:'object',properties:{from:{type:'string'}}}}],
  }});
  assert.equal(seen.url,'https://api.openai.com/v1/responses');
  assert.equal(seen.options.headers.authorization,'Bearer oa-secret');
  const body=JSON.parse(seen.options.body);
  assert.equal(body.model,'configured-model');
  assert.equal(body.instructions,'be concise');
  assert.equal(body.max_output_tokens,123);
  assert.equal(body.tools[0].name,'calendar.list');
  assert.equal(result.model,'gpt-live-alias');
  assert.equal(result.output,'hello');
  assert.deepEqual(result.toolCalls,[{id:'call-1',function:{name:'calendar.list',arguments:'{"from":"today"}'}}]);
  assert.deepEqual(result.usage,{inputTokens:7,outputTokens:3,totalTokens:10});
});

test('DeepSeek adapter uses Responses-compatible boundary without hard-coded model IDs',async()=>{
  let body;
  const adapter=createDeepSeekModelAdapter({
    apiKey:'ds-secret',
    fetchImpl:fakeFetch({
      model:'provider-returned-model',
      output:[{type:'message',content:[{type:'output_text',text:'deep'}]}],
      usage:{input_tokens:2,output_tokens:1,total_tokens:3},
    },{onRequest:(_url,options)=>{body=JSON.parse(options.body);}}),
  });
  const result=await adapter.complete({model:'runtime-configured-deepseek-model',request:{input:'x'}});
  assert.equal(body.model,'runtime-configured-deepseek-model');
  assert.equal(result.output,'deep');
  assert.equal(result.model,'provider-returned-model');
});

test('Anthropic Messages adapter normalizes text, tool_use and usage',async()=>{
  let seen;
  const adapter=createAnthropicModelAdapter({
    apiKey:'an-secret',
    fetchImpl:fakeFetch({
      model:'claude-live-alias',
      content:[
        {type:'text',text:'working'},
        {type:'tool_use',id:'toolu_1',name:'note.write',input:{name:'x',content:'y'}},
      ],
      usage:{input_tokens:5,output_tokens:4},
    },{onRequest:(url,options)=>{seen={url,options};}}),
  });
  const result=await adapter.complete({model:'configured-claude',request:{
    input:'do it',
    system:'system rule',
    tools:[{name:'note.write',parameters:{type:'object',properties:{name:{type:'string'}}}}],
  }});
  assert.equal(seen.url,'https://api.anthropic.com/v1/messages');
  assert.equal(seen.options.headers['x-api-key'],'an-secret');
  assert.equal(seen.options.headers['anthropic-version'],'2023-06-01');
  const body=JSON.parse(seen.options.body);
  assert.equal(body.system,'system rule');
  assert.equal(body.messages[0].content,'do it');
  assert.equal(body.tools[0].input_schema.type,'object');
  assert.equal(result.output,'working');
  assert.deepEqual(result.toolCalls,[{id:'toolu_1',name:'note.write',input:{name:'x',content:'y'}}]);
  assert.deepEqual(result.usage,{inputTokens:5,outputTokens:4,totalTokens:null});
});

test('Gemini generateContent adapter normalizes model version, function calls and usage',async()=>{
  let seen;
  const adapter=createGeminiModelAdapter({
    apiKey:'gm-secret',
    fetchImpl:fakeFetch({
      modelVersion:'gemini-live-version',
      candidates:[{content:{parts:[
        {text:'gemini'},
        {functionCall:{id:'fc1',name:'calendar.list',args:{from:'today'}}},
      ]}}],
      usageMetadata:{promptTokenCount:6,candidatesTokenCount:2,totalTokenCount:8},
    },{onRequest:(url,options)=>{seen={url,options};}}),
  });
  const result=await adapter.complete({model:'gemini-configured',request:{
    input:'hello',
    system:'system',
    temperature:0.2,
    maxOutputTokens:222,
    tools:[{name:'calendar.list',inputSchema:{type:'object',properties:{from:{type:'string'}}}}],
  }});
  assert.equal(seen.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-configured:generateContent');
  assert.equal(seen.options.headers['x-goog-api-key'],'gm-secret');
  const body=JSON.parse(seen.options.body);
  assert.equal(body.systemInstruction.parts[0].text,'system');
  assert.equal(body.generationConfig.maxOutputTokens,222);
  assert.equal(body.tools[0].functionDeclarations[0].name,'calendar.list');
  assert.equal(result.model,'gemini-live-version');
  assert.equal(result.output,'gemini');
  assert.deepEqual(result.toolCalls,[{id:'fc1',name:'calendar.list',input:{from:'today'}}]);
  assert.deepEqual(result.usage,{inputTokens:6,outputTokens:2,totalTokens:8});
});

test('HTTP provider failures normalize retryability without leaking response or API secret',async()=>{
  const adapter=createOpenAIModelAdapter({
    apiKey:'never-leak-me',
    fetchImpl:fakeFetch({error:{message:'Authorization Bearer never-leak-me'}},{status:429}),
  });
  await assert.rejects(
    adapter.complete({model:'m',request:{input:'x'}}),
    (error)=>error.code==='RATE_LIMIT'&&error.retryable===true&&JSON.stringify(error).includes('never-leak-me')===false,
  );
});

test('router executes one neutral request across OpenAI, Anthropic, Gemini and DeepSeek adapters',async()=>{
  const registry=createModelRegistry();
  const specs=[
    ['openai',createOpenAIModelAdapter({apiKey:'a',fetchImpl:fakeFetch({model:'oa',output:[{type:'message',content:[{type:'output_text',text:'oa'}]}]})})],
    ['anthropic',createAnthropicModelAdapter({apiKey:'b',fetchImpl:fakeFetch({model:'an',content:[{type:'text',text:'an'}]})})],
    ['gemini',createGeminiModelAdapter({apiKey:'c',fetchImpl:fakeFetch({modelVersion:'gm',candidates:[{content:{parts:[{text:'gm'}]}}]})})],
    ['deepseek',createDeepSeekModelAdapter({apiKey:'d',fetchImpl:fakeFetch({model:'ds',output:[{type:'message',content:[{type:'output_text',text:'ds'}]}]})})],
  ];
  for(const [provider,adapter] of specs){
    registry.registerProvider(provider,adapter);
    registry.registerModel({provider,id:'configured',class:'advanced',capabilities:['text'],costRank:1,latencyRank:1});
  }
  const router=createModelRouter({registry});
  for(const [provider] of specs){
    const result=await router.request({input:'same request'},{requiredCapabilities:['text'],pinned:{provider,model:'configured'}});
    assert.equal(result.provider,provider);
    assert.ok(['oa','an','gm','ds'].includes(result.output));
  }
});
