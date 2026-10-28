import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { environment,browser,admin,jpeg,base } from './fixtures.mjs';
import { POLICY_VERSION,receiptHash,driveCall,photoWithoutMetadata,cleanupCollection } from '../src/collection.js';

const settings={enabled:true,url:'https://script.google.com/macros/s/test-deployment/exec',secret:'test-only-secret-'.repeat(4),controller:'Nhóm nghiên cứu thử nghiệm',contact:'test@example.invalid'};
const choice={accepted:true,self_image:true,policy_version:POLICY_VERSION};
function drive(calls=[],options={}) {
  return async(url,request)=>{
    const body=JSON.parse(request.body);calls.push({url,body,request});
    if(options.fail?.(body)) throw new Error('fixture transport error');
    return Response.json({ok:true,protocol:'acne-drive-v1',private:true,retention_days:90,...(body.action==='upload'?{id:body.id}:{}),...(body.action==='withdraw'?{erased:true}:{})});
  };
}
async function ready(fetcher=drive()) {
  const env=environment(),owner=await admin(env,fetcher);
  assert.equal((await owner.json('/api/collection-settings',{...settings,admin_token:owner.token})).status,200);
  const guest=browser(env,fetcher);await guest.open();return {env,owner,guest};
}
test('collection defaults off; image uploads without consent never call Drive',async()=>{
  const calls=[],env=environment(),guest=browser(env,drive(calls));await guest.open();
  assert.equal((await guest.json('/api/state')).collection.available,false);
  assert.equal((await guest.json('/api/photo',{data:jpeg,name:'private-name.jpg'})).status,200);
  assert.equal(calls.length,0);
  assert.equal((await guest.json('/api/collection-consent',choice)).status,409);
});
test('admin config needs a token; secret encrypted and absent from state; arbitrary endpoints rejected',async()=>{
  const {env,owner,guest}=await ready();
  assert.equal((await guest.json('/api/collection-settings',settings)).status,403);
  assert.equal((await owner.json('/api/collection-settings',{...settings})).status,403);
  assert.equal((await owner.json('/api/collection-settings',{...settings,url:'https://evil.example/exec',admin_token:owner.token})).status,400);
  const state=await guest.json('/api/state');assert.ok(!JSON.stringify(state).includes(settings.secret));
  assert.ok(!env.DB.raw.prepare("SELECT value FROM settings WHERE key='collection_config'").get().value.includes(settings.secret));
});
test('declining keeps recognition available and sends no photographs to configured Drive',async()=>{
  const calls=[],{guest}=await ready(drive(calls));calls.length=0;
  assert.equal((await guest.json('/api/collection-consent',{accepted:false})).status,200);
  assert.equal((await guest.json('/api/photo',{data:jpeg})).status,200);assert.equal(calls.length,0);
});
test('own-image, boolean and current policy consent are required without an age field',async()=>{
  const {env,guest}=await ready();
  for(const invalid of [{...choice,self_image:false},{...choice,policy_version:'old'},{...choice,accepted:'true'}])assert.equal((await guest.json('/api/collection-consent',invalid)).status,400);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM collection_consents').get().n,0);
});
test('only photos added after consent are donated; receipt returned once, not in stored/public state',async()=>{
  const calls=[],{env,guest}=await ready(drive(calls));
  const old=await guest.json('/api/photo',{data:jpeg,name:'old.jpg'});
  const consent=await guest.json('/api/collection-consent',choice);assert.match(consent.collection_receipt,/^[a-f0-9]{48}$/);
  assert.equal((await guest.json('/api/collection-retry',{id:old.photos[0].id})).status,403);
  const result=await guest.json('/api/photo',{data:jpeg,name:'sensitive-person-name.jpg'});
  assert.equal(result.photos[1].collection_status,'sent');
  const uploads=calls.filter(x=>x.body.action==='upload');assert.equal(uploads.length,1);
  assert.equal(uploads[0].body.name,undefined);assert.equal(uploads[0].body.chats,undefined);
  assert.equal(uploads[0].body.consent.expires_at-uploads[0].body.consent.accepted_at,90*86400);
  assert.ok(!JSON.stringify(await guest.json('/api/state')).includes(consent.collection_receipt));
  assert.ok(!env.DB.raw.prepare('SELECT data FROM sessions ORDER BY rowid DESC').get().data.includes(consent.collection_receipt));
});
test('EXIF/APP metadata is stripped from contributed JPEG while dimensions remain valid',()=>{
  const original=Buffer.from(jpeg,'base64'),label=Buffer.from('Exif\0\0GPS_AND_IDENTITY');
  const segment=Buffer.alloc(4+label.length);segment[0]=255;segment[1]=225;segment.writeUInt16BE(label.length+2,2);label.copy(segment,4);
  const input=Buffer.concat([original.subarray(0,2),segment,original.subarray(2)]).toString('base64');
  const clean=Buffer.from(photoWithoutMetadata(input),'base64');assert.ok(!clean.includes(label));assert.equal(clean.at(-1),217);
});
test('a Drive outage does not break photo recognition; retry reuses id and never duplicates sent photo',async()=>{
  const calls=[];let fail=true;const {guest}=await ready(drive(calls,{fail:b=>b.action==='upload' && fail}));
  await guest.json('/api/collection-consent',choice);
  const photo=(await guest.json('/api/photo',{data:jpeg})).photos[0];assert.equal(photo.collection_status,'failed');
  fail=false;assert.equal((await guest.json('/api/collection-retry',{id:photo.id})).photos[0].collection_status,'sent');
  assert.equal((await guest.json('/api/collection-retry',{id:photo.id})).status,200);
  const uploads=calls.filter(x=>x.body.action==='upload');assert.equal(uploads.length,2);assert.equal(uploads[0].body.id,uploads[1].body.id);
});
test('another visitor cannot donate a private photo; consent does not carry across sessions',async()=>{
  const calls=[],{env,guest}=await ready(drive(calls));await guest.json('/api/collection-consent',choice);
  const photo=(await guest.json('/api/photo',{data:jpeg})).photos[0];
  const other=browser(env,drive(calls));await other.open();
  assert.equal((await other.json('/api/collection-retry',{id:photo.id})).status,404);
  const before=calls.length;await other.json('/api/photo',{data:jpeg});assert.equal(calls.length,before);
});
test('withdrawal works with receipt in a new session after session expiry; original sink retained when collection switched off',async()=>{
  const calls=[],{env,owner,guest}=await ready(drive(calls));
  const consent=await guest.json('/api/collection-consent',choice);await guest.json('/api/photo',{data:jpeg});
  await owner.json('/api/collection-settings',{enabled:false,admin_token:owner.token});
  env.DB.raw.exec('DELETE FROM sessions');const later=browser(env,drive(calls));await later.open();
  const erased=await later.json('/api/collection-withdraw',{code:consent.collection_receipt});assert.equal(erased.collection_withdrawal.erased,true);
  const row=env.DB.raw.prepare('SELECT revoked,erased FROM collection_consents').get();assert.equal(row.revoked,1);assert.equal(row.erased,1);
  assert.equal(calls.at(-1).body.action,'withdraw');assert.equal(calls.at(-1).url,settings.url);
});
test('failed withdrawal stops new collections immediately; cron retries and confirms erasure later',async()=>{
  const calls=[];let fail=true;const fetcher=drive(calls,{fail:b=>b.action==='withdraw' && fail}),{env,guest}=await ready(fetcher);
  await guest.json('/api/collection-consent',choice);await guest.json('/api/photo',{data:jpeg});
  assert.equal((await guest.json('/api/collection-withdraw',{})).status,502);
  assert.equal((await guest.json('/api/state')).collection.accepted,false);
  const before=calls.length;await guest.json('/api/photo',{data:jpeg});assert.equal(calls.length,before);
  fail=false;await cleanupCollection(env,fetcher);assert.equal(env.DB.raw.prepare('SELECT erased FROM collection_consents').get().erased,1);
});
test('expiry prevents donation and settings changes cannot silently switch the recipient of active consents',async()=>{
  const calls=[],{env,owner,guest}=await ready(drive(calls));await guest.json('/api/collection-consent',choice);
  assert.equal((await owner.json('/api/collection-settings',{...settings,controller:'Different owner',admin_token:owner.token})).status,400);
  env.DB.raw.exec('UPDATE collection_consents SET expires=0');const before=calls.length;
  await guest.json('/api/photo',{data:jpeg});assert.equal(calls.length,before);
});
test('redirects only go to Google ContentService as GET, without key or photograph',async()=>{
  const calls=[];await driveCall(settings,'ping',{},async(url,request)=>{
    calls.push({url,request});return calls.length===1?new Response(null,{status:302,headers:{Location:'https://script.googleusercontent.com/macros/echo?user_content_key=test'}}):Response.json({ok:true,protocol:'acne-drive-v1'});
  });
  assert.equal(calls[1].request.method,'GET');assert.equal(calls[1].request.body,undefined);assert.equal(calls[1].request.headers,undefined);
  let count=0;await assert.rejects(()=>driveCall(settings,'upload',{data:jpeg},async()=>{count++;return new Response(null,{status:302,headers:{Location:'https://evil.example/'}});}));assert.equal(count,1);
});
test('receipt guessing, cross-origin consent and unknown deletion codes are rejected',async()=>{
  const {guest}=await ready();assert.equal((await guest.json('/api/collection-consent',choice,{Origin:'https://evil.example'})).status,403);
  assert.equal((await guest.json('/api/collection-withdraw',{code:'bad'})).status,400);
  assert.equal((await guest.json('/api/collection-withdraw',{code:'a'.repeat(48)})).status,404);
});

// Execute the actual Apps Script with a synthetic private Drive, not a reimplementation.
function scriptFixture() {
  const roots=[],byId=new Map();let next=0;
  function folder(name) {
    const record={id:String(++next),name,description:'',children:[],files:[],trash:false};byId.set(record.id,record);
    const iter=items=>{let i=0;return {hasNext:()=>i<items.length,next:()=>items[i++]};};
    const f={...record,getId:()=>record.id,getName:()=>name,isTrashed:()=>record.trash,setTrashed:x=>record.trash=x,getSharingAccess:()=> 'PRIVATE',getEditors:()=>[],getViewers:()=>[],setSharing:()=>{},getDescription:()=>record.description,setDescription:x=>record.description=x,getFolders:()=>iter(record.children),getFoldersByName:n=>iter(record.children.filter(x=>x.getName()===n)),createFolder:n=>{const child=folder(n);record.children.push(child);return child;},getFiles:()=>iter(record.files.filter(x=>!x.deleted)),getFilesByName:n=>iter(record.files.filter(x=>!x.deleted && x.name===n)),createFile:blob=>{const file={id:String(++next),name:blob.name,getId(){return this.id;},setDescription:x=>{},deleted:false};record.files.push(file);byId.set(file.id,file);return file;},record};return f;
  }
  const root=folder('root');roots.push(root);const props={COLLECTION_FOLDER_ID:root.getId(),COLLECTION_SECRET:settings.secret};byId.set(root.getId(),root);
  const context=vm.createContext({console,Date,JSON,Number,Error,encodeURIComponent,
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]})},
    DriveApp:{getFolderById:id=>byId.get(id),Access:{PRIVATE:'PRIVATE'},Permission:{NONE:'NONE'}},
    ScriptApp:{getProjectTriggers:()=>[{getHandlerFunction:()=> 'cleanupExpiredImages'}],getOAuthToken:()=> 'synthetic-only'},
    LockService:{getScriptLock:()=>({waitLock(){},hasLock:()=>true,releaseLock(){}})},
    Utilities:{base64Decode:s=>Array.from(Buffer.from(s,'base64')),newBlob:(bytes,type,name)=>({bytes,type,name})},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>({text})})},
    UrlFetchApp:{fetch:url=>{byId.get(url.split('/').at(-1)).deleted=true;return {getResponseCode:()=>204};}}
  });vm.runInContext(readFileSync(new URL('../google-drive/Code.gs',import.meta.url),'utf8'),context);
  const call=body=>JSON.parse(context.doPost({postData:{contents:JSON.stringify({secret:settings.secret,...body})}}).text);
  return {context,call,root};
}
test('actual Apps Script rejects unauthenticated input, duplicates no files, permanently deletes and blocks late upload',()=>{
  const {call,root}=scriptFixture(),created=Math.floor(Date.now()/1000),receipt_hash='a'.repeat(64),id='b'.repeat(24);
  const upload={action:'upload',receipt_hash,id,data:jpeg,consent:{version:POLICY_VERSION,self_image:true,accepted_at:created,expires_at:created+90*86400}};
  assert.equal(call({...upload,secret:'wrong'}).ok,false);assert.equal(root.record.children.length,0);
  assert.equal(call(upload).ok,true);assert.equal(call(upload).ok,true);assert.equal(root.record.children[0].record.files.length,1);
  assert.equal(call({action:'withdraw',receipt_hash,expires_at:upload.consent.expires_at}).erased,true);
  assert.equal(root.record.children[0].record.files[0].deleted,true);assert.equal(call(upload).ok,false);
});
test('actual Apps Script scheduled cleanup permanently removes expired photographs',()=>{
  const {context,root}=scriptFixture(),child=root.createFolder('c'.repeat(64));
  child.setDescription(JSON.stringify({expires:1,revoked:false}));child.createFile({name:'expired.jpg'});
  context.cleanupExpiredImages();assert.equal(child.record.files[0].deleted,true);assert.equal(child.record.trash,true);
});
