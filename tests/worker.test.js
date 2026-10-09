import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { handle } from '../src/worker.js';
import { encrypt, decrypt, endpoint } from '../src/security.js';
import { imageContext, parsePrediction, jpegInfo } from '../src/core.js';
import { guardAnswer, retrieve } from '../src/rag.js';
import corpus from '../data/corpus.json' with {type:'json'};

const secret='a'.repeat(64), setupToken='b'.repeat(48), base='https://nsl.example.com';
// Tiny generated JPEG fixture, not a user's photograph.
const jpeg=readFileSync(new URL('fixture.jpg',import.meta.url)).toString('base64');
function sqlite() {
  const raw=new DatabaseSync(':memory:');raw.exec(readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  return {raw,prepare(sql){let params=[];const statement=()=>raw.prepare(sql);return {
    bind(...args){params=args;return this;}, async first(){return statement().get(...params)||null;},
    async all(){return {results:statement().all(...params)};},async run(){const r=statement().run(...params);return {meta:{changes:Number(r.changes)}};}
  };},async batch(statements){return Promise.all(statements.map(s=>s.run()));}};
}
function environment() {
  return {DB:sqlite(),APP_SECRET:secret,ADMIN_SETUP_TOKEN:setupToken,RAG:{query:async()=>({matches:[{id:corpus.chunks[0].id,score:.9}]})},ASSETS:{fetch:async request=>{
    const path=decodeURIComponent(new URL(request.url).pathname);return new Response(readFileSync(new URL('../public'+path,import.meta.url)));
  }}};
}
function browser(env,fetcher) {
  let cookie='',csrf='';return {
    async request(path,body,extra={}) {
      const request=new Request(base+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:base,'Content-Type':'application/json','X-Acne-Token':csrf}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
      const result=await handle(request,env,{},fetcher);const set=result.headers.get('Set-Cookie');if(set)cookie=set.split(';')[0];return result;
    },async open(){const result=await this.request('/');const text=await result.text();csrf=text.match(/name="acne-token" content="([^"]+)"/)[1];return text;},
    async json(path,body,extra){const response=await this.request(path,body,extra);return {status:response.status,...await response.json()};}
  };
}
async function admin(env,fetcher) {
  const b=browser(env,fetcher);await b.open();assert.equal((await b.json('/api/admin-setup',{setup_token:setupToken,password:'test-password-123',confirmation:'test-password-123'})).status,200);
  const login=await b.json('/api/admin-login',{username:'admin',password:'test-password-123'});assert.equal(login.status,200);b.token=login.admin_token;return b;
}
const detectionData=(count=2)=>({metadata:{task:'detect',classNames:['whiteheads']},images:[{shape:[16,16],results:Array.from({length:count},()=>({class:0,name:'whiteheads',confidence:.9,box:{x1:1,y1:2,x2:8,y2:10}}))}]});

test('AES authenticated encryption roundtrip; wrong secret fails',async()=>{const encoded=await encrypt('test-only-secret',secret);assert.ok(!encoded.includes('test-only-secret'));assert.equal(await decrypt(encoded,secret),'test-only-secret');await assert.rejects(decrypt(encoded,'b'.repeat(64)));});
for(const url of ['http://x.a.run.app','https://x.a.run.app/evil','https://x.a.run.app?key=secret','https://x.a.run.app:443/path','https://x.a.run.app@evil.com','https://x.a.run.app.evil.com','https://127.0.0.1'])test('reject unsafe endpoint '+url,()=>assert.throws(()=>endpoint(url)));
test('root has per-session CSRF and HttpOnly cookie; secrets absent from state',async()=>{const env=environment(),b=browser(env);const html=await b.open();assert.ok(!html.includes('__TOKEN__'));const state=await b.json('/api/state');assert.equal(state.status,200);assert.ok(!JSON.stringify(state).includes(secret));assert.ok(!JSON.stringify(state).includes(setupToken));});
test('public cannot claim admin without owner bootstrap token',async()=>{const env=environment(),b=browser(env);await b.open();assert.equal((await b.json('/api/admin-setup',{password:'test-password-123',confirmation:'test-password-123'})).status,403);assert.equal((await b.json('/api/state')).admin.configured,false);});
test('bootstrap is single-use and setup does not log user in',async()=>{const env=environment(),b=browser(env);await b.open();const body={setup_token:setupToken,password:'test-password-123',confirmation:'test-password-123'};const created=await b.json('/api/admin-setup',body);assert.equal(created.admin.logged_in,false);assert.equal((await b.json('/api/admin-setup',body)).status,400);});
test('Origin and CSRF checks both required',async()=>{const env=environment(),b=browser(env);await b.open();for(const headers of [{Origin:'https://evil.com'},{'X-Acne-Token':'bad'},{Origin:''}])assert.equal((await b.json('/api/invalidate',{},headers)).status,403);});
test('guest cannot mutate models or shared chatbot key',async()=>{const env=environment(),b=browser(env);await b.open();for(const path of ['/api/add-remote-model','/api/delete-remote-model','/api/chat-settings','/api/delete-chat-key'])assert.equal((await b.json(path,{})).status,403);});
test('login token is needed even with admin cookie; logout revokes it',async()=>{const env=environment(),b=await admin(env);assert.equal((await b.json('/api/chat-settings',{key:'test-key12345678'})).status,403);assert.equal((await b.json('/api/chat-settings',{key:'test-key12345678',admin_token:b.token})).status,200);await b.json('/api/admin-logout',{});assert.equal((await b.json('/api/delete-chat-key',{admin_token:b.token})).status,403);});
test('admin keys are encrypted; guests see two selectable models and deletion preserves other',async()=>{const env=environment(),b=await admin(env);const guest=browser(env);await guest.open();
  for(const name of ['Model A','Model B'])assert.equal((await b.json('/api/add-remote-model',{admin_token:b.token,name,endpoint:'https://x.a.run.app',key:'ul_test_only_12345678'})).status,200);
  const state=await guest.json('/api/state');assert.equal(state.remote.models.length,2);assert.ok(!JSON.stringify(state).includes('ul_test_only'));assert.ok(!env.DB.raw.prepare('SELECT encrypted_key FROM models').get().encrypted_key.includes('ul_test_only'));
  await b.json('/api/delete-remote-model',{admin_token:b.token,id:state.remote.models[0].id});assert.equal((await guest.json('/api/state')).remote.models.length,1);
});
test('photos are encrypted and session private; invalid photo rejected',async()=>{const env=environment(),a=browser(env),b=browser(env);await a.open();await b.open();const created=await a.json('/api/photo',{name:'test.jpg',data:jpeg});assert.equal(created.status,200);assert.ok(!env.DB.raw.prepare('SELECT data FROM photos').get().data.startsWith(jpeg.slice(0,20)));assert.equal((await b.request('/photo?id='+created.photos[0].id)).status,404);assert.equal((await a.json('/api/photo',{data:'not-a-jpeg'})).status,400);});
test('JPEG dimensions checked',()=>{const {width,height}=jpegInfo(jpeg);assert.deepEqual({width,height},{width:16,height:16});});
test('remote parser rejects other dataset and mismatched dimensions',()=>{const data=detectionData();data.metadata.classNames=['tomato'];assert.throws(()=>parsePrediction(data,{width:16,height:16},.25,1));assert.throws(()=>parsePrediction(detectionData(),{width:32,height:16},.25,1));});
test('remote parser respects class metadata, threshold, finite scores and clip',()=>{const data=detectionData();data.images[0].results[0].confidence=.2;assert.equal(parsePrediction(data,{width:16,height:16},.25,1).detections.length,1);data.images[0].results[1].confidence=NaN;assert.throws(()=>parsePrediction(data,{width:16,height:16},.25,1));});
test('single/all image context does not sum views and rejects stale confidence',()=>{const result=parsePrediction(detectionData(),{width:16,height:16},.25,1),s={photos:[{id:'a',result},{id:'b',result}]};const one=imageContext(s,'one','b',.25);assert.equal(one.chi_so_anh,2);assert.equal(one.tong_so_vung,2);const all=imageContext(s,'all','a',.25);assert.equal(all.cac_anh.length,2);assert.equal(all.tong_so_vung,undefined);assert.throws(()=>imageContext(s,'all','a',.4));});
test('dosage guard blocks Markdown doses; citations include only actually cited sources',()=>{assert.equal(guardAnswer('**20 mg** mỗi ngày',[]).sources.length,0);assert.ok(!guardAnswer('**20 mg** mỗi ngày',[]).answer.includes('20'));assert.deepEqual(guardAnswer('Chăm sóc da [2]. Không có nguồn [9].',[{citation:1},{citation:2}]).sources,[{citation:2}]);});
test('RAG uses multilingual semantic query with fixed 768 dimensions and ignores unknown IDs',async()=>{let query;const env=environment();env.RAG.query=async(vector)=>{assert.equal(vector.length,768);return {matches:[{id:'unknown',score:1},{id:corpus.chunks.find(c=>c.language==='en').id,score:.9}]};};const sources=await retrieve(env,'test-key','mụn trứng cá là gì',[],async(url,options)=>{query=JSON.parse(options.body);return Response.json({embedding:{values:Array(768).fill(.1)}});});assert.equal(query.taskType,'RETRIEVAL_QUERY');assert.ok(query.content.parts[0].text.includes('mụn'));assert.equal(sources[0].language,'en');});
test('expired sessions cannot read old photos, cron schema cascades private data',async()=>{const env=environment(),b=browser(env);await b.open();const uploaded=await b.json('/api/photo',{name:'test.jpg',data:jpeg});env.DB.raw.exec('UPDATE sessions SET expires=0');assert.equal((await b.request('/photo?id='+uploaded.photos[0].id)).status,401);env.DB.raw.exec('DELETE FROM sessions WHERE expires=0');assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM photos').get().n,0);});
test('chat without photos works; image chat uses chosen photo; deleted model and stale threshold rejected',async()=>{
  const calls=[];let scans=0;
  const fetcher=async(url,options)=>{
    if(url.endsWith('/predict')){scans++;assert.equal(options.redirect,'error');assert.ok(options.headers.Authorization.startsWith('Bearer ul_'));return Response.json(detectionData(scans));}
    const payload=JSON.parse(options.body);calls.push({url,payload});
    if(url.endsWith(':embedContent'))return Response.json({embedding:{values:Array(768).fill(.1)}});
    return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Hướng dẫn chăm sóc da [1].'}]}}]});
  };
  const env=environment(),a=await admin(env,fetcher),b=browser(env,fetcher);await b.open();
  await a.json('/api/chat-settings',{admin_token:a.token,key:'test-key-12345678'});
  const modelState=await a.json('/api/add-remote-model',{admin_token:a.token,name:'Model',endpoint:'https://x.a.run.app',key:'ul_test_only_12345678'}),model=modelState.remote.models[0].id;
  const general=await b.json('/api/chat',{mode:'general',message:'Chăm sóc da như nào?'});assert.equal(general.status,200);assert.equal(general.chats.general.length,2);
  await b.json('/api/photo',{name:'one.jpg',data:jpeg});const uploaded=await b.json('/api/photo',{name:'two.jpg',data:jpeg});
  const scanned=await b.json('/api/scan',{provider:'remote',remote_model:model,confidence:.25});assert.equal(scanned.status,200);assert.equal(scanned.photos[1].detections.length,2);
  const question={mode:'image',message:'Phân tích ảnh',scope:'one',image_id:uploaded.photos[1].id,confidence:.25};
  const chat=await b.json('/api/chat',question);assert.equal(chat.status,200);assert.equal(chat.chats.image.length,2);
  const content=JSON.parse(calls.at(-1).payload.contents.at(-1).parts[0].text.split('Dữ liệu tham khảo (JSON):\n')[1]);assert.equal(content.ket_qua_nhan_dien.chi_so_anh,2);assert.equal(content.ket_qua_nhan_dien.tong_so_vung,2);assert.ok(!JSON.stringify(calls).includes(jpeg));
  assert.equal((await b.json('/api/chat',{...question,confidence:.4})).status,400);
  await a.json('/api/delete-remote-model',{id:model,admin_token:a.token});assert.equal((await b.json('/api/chat',question)).status,400);assert.equal((await b.json('/api/state')).photos[0].scanned,false);
});
