import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/worker.js';
import { encrypt } from '../src/security.js';
import { retrieve, reply, guardAnswer } from '../src/rag.js';
import corpus from '../data/corpus.json' with {type:'json'};
import { secret, base, jpeg, environment, browser, admin, detectionData } from './fixtures.mjs';

const google = async url => url.endsWith(':embedContent')
  ? Response.json({embedding:{values:Array(768).fill(.1)}})
  : Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Chăm sóc da nhẹ nhàng [1].'}]}}]});
async function ready(fetcher=google) {
  const env=environment(),b=browser(env,fetcher);await b.open();
  await env.DB.prepare("INSERT INTO settings(key,value) VALUES('chat_key',?)").bind(await encrypt('test-key-only',secret)).run();
  await env.DB.prepare('INSERT INTO models(id,name,endpoint,encrypted_key) VALUES(?,?,?,?)').bind('model','Test','https://test.a.run.app',await encrypt('ul_test_only_12345678',secret)).run();
  return {env,b};
}
const scan={provider:'remote',remote_model:'model',confidence:.25};
const question={mode:'general',message:'Chăm sóc da thế nào?'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('80 simultaneous arrivals admit exactly 64 sessions and reject the rest',async()=>{
  const env=environment();const responses=await Promise.all(Array.from({length:80},()=>handle(new Request(base+'/'),env,{})));
  assert.equal(responses.filter(r=>r.status===200).length,64);
  assert.equal(responses.filter(r=>r.status===429).length,16);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,64);
});
test('successful mutation renews Secure HttpOnly cookie alongside database expiry',async()=>{
  const {env,b}=await ready();env.DB.raw.exec('UPDATE sessions SET expires=expires-1800');
  const response=await b.request('/api/reset-chat',{mode:'general'});
  assert.equal(response.status,200);const cookie=response.headers.get('Set-Cookie');
  assert.ok(cookie?.includes('Max-Age=3600') && cookie.includes('HttpOnly') && cookie.includes('Secure'));
});
test('expired state request returns 401 without silently replacing CSRF session',async()=>{
  const {env,b}=await ready();env.DB.raw.exec('UPDATE sessions SET expires=0');
  assert.equal((await b.request('/api/state')).status,401);
  assert.equal((await b.request('/')).status,200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
});
test('mutation lock rejects a second request without losing photo or chat data',async()=>{
  const entered=deferred(),release=deferred();const {env,b}=await ready(async(url,opts)=>{
    if(url.endsWith(':generateContent')) {entered.resolve();await release.promise;}return google(url,opts);
  });
  const first=b.json('/api/chat',question);await entered.promise;
  assert.equal((await b.json('/api/photo',{name:'parallel.jpg',data:jpeg})).status,409);
  const during=await b.json('/api/state');assert.equal(during.job.busy,true);
  release.resolve();assert.equal((await first).status,200);
  const after=await b.json('/api/state');assert.equal(after.job.busy,false);assert.equal(after.chats.general.length,2);
  assert.equal(env.DB.raw.prepare('SELECT lock_until FROM sessions').get().lock_until,0);
});
test('separate sessions can run AI requests concurrently',async()=>{
  const release=deferred();let entered=0;const both=deferred();
  const fetcher=async(url,opts)=>{if(url.endsWith(':generateContent')) {if(++entered===2)both.resolve();await release.promise;}return google(url,opts);};
  const {env,b}=await ready(fetcher),other=browser(env,fetcher);await other.open();
  const requests=[b.json('/api/chat',question),other.json('/api/chat',question)];
  await both.promise;release.resolve();assert.deepEqual((await Promise.all(requests)).map(r=>r.status),[200,200]);
});
test('each session admits six chats and rejects the seventh before calling AI',async()=>{
  let calls=0;const {env,b}=await ready(async(url,opts)=>{calls++;return google(url,opts);});
  for(let i=0;i<6;i++) assert.equal((await b.json('/api/chat',question)).status,200);
  assert.equal((await b.json('/api/chat',question)).status,429);assert.equal(calls,12);
});
test('global chat cap atomically admits 30 out of 35 simultaneous sessions',async()=>{
  const {env}=await ready();const clients=Array.from({length:35},()=>browser(env,google));await Promise.all(clients.map(b=>b.open()));
  const results=await Promise.all(clients.map(b=>b.json('/api/chat',question)));
  assert.equal(results.filter(r=>r.status===200).length,30);assert.equal(results.filter(r=>r.status===429).length,5);
});
test('12 photo cap rejects thirteenth without orphan rows',async()=>{
  const {env,b}=await ready();for(let i=0;i<12;i++)assert.equal((await b.json('/api/photo',{name:'test.jpg',data:jpeg})).status,200);
  assert.equal((await b.json('/api/photo',{data:jpeg})).status,400);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM photos').get().n,12);
});
test('unsupported methods, routes and content types produce client errors',async()=>{
  const {env,b}=await ready();assert.equal((await b.request('/missing')).status,404);
  assert.equal((await b.json('/api/missing',{})).status,404);
  assert.equal((await b.json('/api/photo',{data:jpeg},{'Content-Type':'text/plain'})).status,415);
  assert.equal((await handle(new Request(base+'/',{method:'PUT'}),env,{})).status,405);
  assert.equal((await b.json('/api/reset-chat',{mode:'unknown'})).status,400);
});
test('body limit rejects oversized declared and actual payloads',async()=>{
  const {b}=await ready();assert.equal((await b.json('/api/photo',{}, {'Content-Length':'1250001'})).status,413);
  assert.equal((await b.json('/api/photo',{data:'x'.repeat(1250001)})).status,413);
});
test('invalid scan threshold and local provider never call detection endpoint',async()=>{
  let calls=0;const {b}=await ready(async()=>{calls++;throw new Error('must not call');});
  await b.json('/api/photo',{data:jpeg});
  for(const confidence of [null,'0.25',0,1])assert.equal((await b.json('/api/scan',{...scan,confidence})).status,400);
  assert.equal((await b.json('/api/scan',{...scan,provider:'local'})).status,400);assert.equal(calls,0);
});
test('expired admin authorization cannot edit shared keys',async()=>{
  const env=environment(),b=await admin(env);const row=env.DB.raw.prepare('SELECT id,data FROM sessions').get();
  const data=JSON.parse(row.data);data.admin_until=0;env.DB.raw.prepare('UPDATE sessions SET data=? WHERE id=?').run(JSON.stringify(data),row.id);
  assert.equal((await b.json('/api/chat-settings',{admin_token:b.token,key:'test-key-only'})).status,403);
});
test('another session cannot remove or read owner photo',async()=>{
  const {env,b}=await ready(),other=browser(env);await other.open();const uploaded=await b.json('/api/photo',{data:jpeg});const id=uploaded.photos[0].id;
  await other.json('/api/remove-photo',{id});assert.equal((await b.request('/photo?id='+id)).status,200);
  assert.equal((await other.request('/photo?id='+id)).status,404);
});
test('partial scan failure retains successful photo; retry clears old errors',async()=>{
  let calls=0;const {b}=await ready(async()=>{if(++calls===2)return new Response('',{status:429});return Response.json(detectionData());});
  await b.json('/api/photo',{data:jpeg});await b.json('/api/photo',{data:jpeg});
  const first=await b.json('/api/scan',scan);assert.equal(first.photos[0].scanned,true);assert.equal(first.photos[1].scanned,false);assert.ok(first.photos[1].error);
  const retry=await b.json('/api/scan',scan);assert.ok(retry.photos.every(p=>p.scanned && !p.error));
});
test('AI quota failure is visible, preserves chat and releases session lock',async()=>{
  const {env,b}=await ready(async()=>Response.json({error:{message:'secret test-key-only',status:'RESOURCE_EXHAUSTED'}},{status:429}));
  const failed=await b.json('/api/chat',question);assert.equal(failed.status,502);assert.ok(!JSON.stringify(failed).includes('test-key-only'));
  const state=await b.json('/api/state');assert.equal(state.chats.general.length,0);assert.equal(state.job.busy,false);
});
test('safety blocked response never commits an empty answer',async()=>{
  const {b}=await ready(async url=>url.endsWith(':embedContent')?google(url):Response.json({promptFeedback:{blockReason:'SAFETY'}}));
  assert.equal((await b.json('/api/chat',question)).status,400);assert.equal((await b.json('/api/state')).chats.general.length,0);
});
test('retrieval excludes non-finite and missing relevance scores',async()=>{
  const env=environment();env.RAG.query=async()=>({matches:[{id:corpus.chunks[0].id,score:NaN},{id:corpus.chunks[1].id},{id:corpus.chunks[2].id,score:Infinity}]});
  assert.equal((await retrieve(env,'test-key-only','mụn',[],google)).length,0);
});
test('no relevant evidence returns labelled general answer with no sources',async()=>{
  const env=environment();env.RAG.query=async()=>({matches:[]});const output=await reply(env,'test-key-only',null,[],question.message,google);
  assert.ok(output.answer.startsWith('Thông tin chung'));assert.deepEqual(output.sources,[]);
});
test('malformed successful Google response maps to upstream error, not internal 500',async()=>{
  const {b}=await ready(async()=>new Response('not JSON',{headers:{'Content-Type':'application/json'}}));
  assert.equal((await b.json('/api/chat',question)).status,502);
});
test('state refresh invalidation cannot overwrite a simultaneous upload',async()=>{
  const {env,b}=await ready(async()=>Response.json(detectionData()));await b.json('/api/photo',{data:jpeg});await b.json('/api/scan',scan);
  env.DB.raw.exec("DELETE FROM models WHERE id='model'");
  const entered=deferred(),release=deferred(),original=env.DB.prepare.bind(env.DB);let gated=false;
  env.DB.prepare=sql=>{const statement=original(sql);if(sql==='SELECT id,name,endpoint FROM models ORDER BY rowid' && !gated){gated=true;const all=statement.all.bind(statement);statement.all=async()=>{entered.resolve();await release.promise;return all();};}return statement;};
  const refresh=b.json('/api/state');await entered.promise;
  assert.equal((await b.json('/api/photo',{name:'new.jpg',data:jpeg})).status,200);release.resolve();await refresh;
  assert.equal((await b.json('/api/state')).photos.length,2);
});
test('expired sessions at capacity are removed with their private photos',async()=>{
  const {env,b}=await ready();await b.json('/api/photo',{data:jpeg});env.DB.raw.exec('UPDATE sessions SET expires=0');
  const result=await handle(new Request(base+'/'),env,{});assert.equal(result.status,200);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM photos').get().n,0);
});
test('global scan cap admits 30 batches across 35 independent sessions',async()=>{
  let calls=0;const fetcher=async()=>{calls++;return Response.json(detectionData());};
  const {env}=await ready(fetcher),clients=Array.from({length:35},()=>browser(env,fetcher));
  await Promise.all(clients.map(async b=>{await b.open();await b.json('/api/photo',{data:jpeg});}));
  const results=await Promise.all(clients.map(b=>b.json('/api/scan',scan)));
  assert.equal(results.filter(r=>r.status===200).length,30);assert.equal(results.filter(r=>r.status===429).length,5);assert.equal(calls,30);
});
test('scan cap counts batches rather than the two images in each batch',async()=>{
  let calls=0;const {b}=await ready(async()=>{calls++;return Response.json(detectionData());});
  await b.json('/api/photo',{data:jpeg});await b.json('/api/photo',{data:jpeg});
  for(let i=0;i<6;i++)assert.equal((await b.json('/api/scan',scan)).status,200);
  assert.equal((await b.json('/api/scan',scan)).status,429);assert.equal(calls,12);
});
test('failed admin login is limited per IP, not bypassed with new sessions',async()=>{
  const env=environment(),owner=await admin(env);
  for(let i=0;i<5;i++) {const b=browser(env);await b.open();assert.equal((await b.json('/api/admin-login',{username:'admin',password:'wrong'},{'CF-Connecting-IP':'192.0.2.10'})).status,403);}
  const b=browser(env);await b.open();assert.equal((await b.json('/api/admin-login',{username:'admin',password:'wrong'},{'CF-Connecting-IP':'192.0.2.10'})).status,429);
});
test('chat history is bounded to the latest ten complete exchanges',async()=>{
  const {env,b}=await ready();for(let i=0;i<12;i++){env.DB.raw.exec('DELETE FROM rates');assert.equal((await b.json('/api/chat',{...question,message:'Câu hỏi '+i})).status,200);}
  const history=(await b.json('/api/state')).chats.general;assert.equal(history.length,20);assert.equal(history[0].text,'Câu hỏi 2');assert.equal(history.at(-2).text,'Câu hỏi 11');
});
test('state invalidation and image chat reset preserve unrelated general chat',async()=>{
  const {b}=await ready(async(url,opts)=>url.endsWith('/predict')?Response.json(detectionData()):google(url,opts));
  await b.json('/api/chat',question);const uploaded=await b.json('/api/photo',{data:jpeg});await b.json('/api/scan',scan);
  await b.json('/api/chat',{mode:'image',message:'Phân tích ảnh',scope:'one',image_id:uploaded.photos[0].id,confidence:.25});
  const reset=await b.json('/api/invalidate',{});assert.equal(reset.chats.general.length,2);assert.equal(reset.chats.image.length,0);assert.equal(reset.photos[0].scanned,false);
});
test('PDF citation is removed from image counts but preserved for adjacent knowledge',()=>{
  const input='Ảnh số 1: Phát hiện tổng cộng **5** vùng mụn đầu trắng [1]. Nhân trứng cá đóng là mụn đầu trắng [1].';
  const guarded=guardAnswer(input,[{citation:1}],{pham_vi:'mot_anh'});
  assert.equal(guarded.answer,'Ảnh số 1: Phát hiện tổng cộng **5** vùng mụn đầu trắng. Nhân trứng cá đóng là mụn đầu trắng [1].');
  assert.equal(guarded.sources.length,1);assert.equal(guardAnswer(input,[{citation:1}]).answer,input);
});
test('image-count-only answer no longer claims a PDF source',()=>{
  const guarded=guardAnswer('Mô hình ghi nhận 3 vùng mụn mủ [2].',[{citation:2}],{});
  assert.equal(guarded.sources.length,0);assert.equal(guarded.answer,'Mô hình ghi nhận 3 vùng mụn mủ.');
});
async function secondAdmin(env) {
  const b=browser(env);await b.open();const login=await b.json('/api/admin-login',{username:'admin',password:'test-password-123'});assert.equal(login.status,200);b.token=login.admin_token;return b;
}
test('two admin sessions adding the final model cannot exceed catalog cap',async()=>{
  const env=environment(),a=await admin(env),b=await secondAdmin(env);
  for(let i=0;i<29;i++)env.DB.raw.prepare('INSERT INTO models(id,name,endpoint,encrypted_key) VALUES(?,?,?,?)').run('seed'+i,'seed'+i,'https://test.a.run.app','fixture');
  const results=await Promise.all([a,b].map((client,i)=>client.json('/api/add-remote-model',{admin_token:client.token,name:'new'+i,endpoint:'https://test.a.run.app',key:'ul_test_only_12345678'})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM models').get().n,30);
});
test('simultaneous duplicate model name returns a clear client error',async()=>{
  const env=environment(),a=await admin(env),b=await secondAdmin(env);
  const results=await Promise.all([a,b].map(client=>client.json('/api/add-remote-model',{admin_token:client.token,name:'Same model',endpoint:'https://test.a.run.app',key:'ul_test_only_12345678'})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM models').get().n,1);
});
