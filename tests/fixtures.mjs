// Shared isolated D1/HTTP fixtures; never reads production credentials.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { handle } from '../src/worker.js';
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

export { secret, setupToken, base, jpeg, sqlite, environment, browser, admin, detectionData };
