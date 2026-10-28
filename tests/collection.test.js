import test from 'node:test';
import assert from 'node:assert/strict';
import { environment,browser,admin,jpeg } from './fixtures.mjs';
import { POLICY_VERSION,STORAGE_LIMIT,IMAGE_LIMIT,receiptHash,photoWithoutMetadata,cleanupCollection,collectionImage } from '../src/collection.js';

const consent={accepted:true,self_image:true,policy_version:POLICY_VERSION,storage:'web'};
const noNetwork=async()=>{throw new Error('Photo library must not call an external storage service');};
async function ready(){const env=environment(),owner=await admin(env,noNetwork),guest=browser(env,noNetwork);await guest.open();return {env,owner,guest};}
async function accept(b){const result=await b.json('/api/collection-consent',consent);assert.equal(result.status,200);return result.collection_receipt;}
const upload=(b,name='synthetic.jpg')=>b.json('/api/photo',{data:jpeg,name});
const list=owner=>owner.json('/api/collection-list',{admin_token:owner.token});
const count=env=>env.DB.raw.prepare('SELECT COUNT(*) n FROM collection_images').get().n;

test('web storage is available without configuration; unconsented and declined images never enter library',async()=>{
 const {env,guest}=await ready();assert.equal((await guest.json('/api/state')).collection.storage,'web');
 await upload(guest);assert.equal(count(env),0);await guest.json('/api/collection-consent',{accepted:false});await upload(guest);assert.equal(count(env),0);
 assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM photos').get().n,2);
});
test('own-image, current policy and boolean consent are required; no age or external key field is needed',async()=>{
 const {env,guest}=await ready();for(const body of [{...consent,self_image:false},{...consent,policy_version:'old'},{...consent,storage:undefined},{...consent,accepted:'true'}])assert.equal((await guest.json('/api/collection-consent',body)).status,400);
 assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM collection_consents').get().n,0);await accept(guest);assert.equal((await upload(guest)).photos[0].collection_status,'sent');assert.equal(count(env),1);
});
test('only images added after consent persist; old images cannot be retroactively donated',async()=>{
 const {env,guest}=await ready(),old=await upload(guest);await accept(guest);
 assert.equal((await guest.json('/api/collection-retry',{id:old.photos[0].id})).status,403);
 await upload(guest);assert.equal(count(env),1);
});
test('receipt is returned once; ciphertext, metadata and public state contain no original name or receipt',async()=>{
 const {env,guest,owner}=await ready(),code=await accept(guest);await upload(guest,'private-name.jpg');
 const row=env.DB.raw.prepare('SELECT * FROM collection_images').get();assert.ok(!row.data.includes(jpeg.slice(0,40)));
 assert.equal(row.expires-env.DB.raw.prepare('SELECT created FROM collection_consents').get().created,90*86400);
 assert.ok(!JSON.stringify(await guest.json('/api/state')).includes(code));assert.ok(!env.DB.raw.prepare('SELECT data FROM sessions ORDER BY rowid DESC').get().data.includes(code));
 const library=(await list(owner)).collection_library;assert.ok(!JSON.stringify(library).includes('private-name'));assert.ok(!JSON.stringify(library).includes(row.data));assert.equal(library.images[0].width,16);
});
test('EXIF/APP metadata is removed while a valid JPEG is preserved',()=>{
 const original=Buffer.from(jpeg,'base64'),label=Buffer.from('Exif\0\0GPS_AND_IDENTITY'),segment=Buffer.alloc(4+label.length);
 segment[0]=255;segment[1]=225;segment.writeUInt16BE(label.length+2,2);label.copy(segment,4);
 const clean=Buffer.from(photoWithoutMetadata(Buffer.concat([original.subarray(0,2),segment,original.subarray(2)]).toString('base64')),'base64');assert.ok(!clean.includes(label));assert.equal(clean.at(-1),217);
});
test('guests and admin cookie alone cannot list, download, configure or delete library images',async()=>{
 const {guest,owner}=await ready();await accept(guest);await upload(guest);const id=(await list(owner)).collection_library.images[0].id;
 for(const b of [guest,owner]){
  assert.equal((await b.json('/api/collection-list',{})).status,403);assert.equal((await b.json('/api/collection-delete',{ids:[id]})).status,403);
  assert.equal((await b.request('/api/collection-image?id='+id)).status,403);
 }
 assert.equal((await guest.json('/api/collection-settings',{enabled:false})).status,403);
 assert.equal((await guest.request('/api/collection-image?id='+id,undefined,{'X-Admin-Token':owner.token})).status,403);
});
test('authenticated admin downloads a real JPEG; logout revokes image access and no-store headers protect caches',async()=>{
 const {guest,owner}=await ready();await accept(guest);await upload(guest);const id=(await list(owner)).collection_library.images[0].id;
 const result=await owner.request('/api/collection-image?id='+id,undefined,{'X-Admin-Token':owner.token});assert.equal(result.status,200);assert.match(result.headers.get('Content-Type'),/image\/jpeg/);assert.equal(result.headers.get('Cache-Control'),'no-store');
 assert.deepEqual(Buffer.from(await result.arrayBuffer()),Buffer.from(photoWithoutMetadata(jpeg),'base64'));
 await owner.json('/api/admin-logout',{});assert.equal((await owner.request('/api/collection-image?id='+id,undefined,{'X-Admin-Token':owner.token})).status,403);
});
test('persistent images outlive browsing sessions and remain accessible to a newly authenticated admin',async()=>{
 const {env,guest}=await ready();await accept(guest);await upload(guest);env.DB.raw.exec('DELETE FROM sessions');assert.equal(count(env),1);
 const later=browser(env,noNetwork);await later.open();const login=await later.json('/api/admin-login',{username:'admin',password:'test-password-123'});later.token=login.admin_token;
 assert.equal((await list(later)).collection_library.total,1);
});
test('admin deletion cannot be undone by retrying a previously contributed photo',async()=>{
 const {env,guest,owner}=await ready();await accept(guest);const photo=(await upload(guest)).photos[0],id=(await list(owner)).collection_library.images[0].id;
 assert.equal((await owner.json('/api/collection-delete',{ids:[id],admin_token:owner.token})).collection_deletion.deleted,1);
 assert.equal((await guest.json('/api/collection-retry',{id:photo.id})).photos[0].collection_status,'deleted');assert.equal(count(env),0);
 assert.equal((await owner.request('/api/collection-image?id='+id,undefined,{'X-Admin-Token':owner.token})).status,404);
});
test('withdrawal works in another session and erases only the matching contribution group',async()=>{
 const {env,guest}=await ready(),code=await accept(guest);await upload(guest);
 const other=browser(env,noNetwork);await other.open();await accept(other);await upload(other);assert.equal(count(env),2);
 const later=browser(env,noNetwork);await later.open();assert.equal((await later.json('/api/collection-withdraw',{code})).collection_withdrawal.erased,true);assert.equal(count(env),1);
 assert.equal((await guest.json('/api/state')).collection.accepted,false);await upload(guest);assert.equal(count(env),1);
});
test('withdrawal remains possible after all original browsing sessions expire',async()=>{
 const {env,guest}=await ready(),code=await accept(guest);await upload(guest);env.DB.raw.exec('UPDATE sessions SET expires=0');
 const later=browser(env,noNetwork);await later.open();assert.equal(count(env),1);assert.equal((await later.json('/api/collection-withdraw',{code})).status,200);assert.equal(count(env),0);
});
test('expired photos cannot be downloaded even before scheduled cleanup; cleanup removes them',async()=>{
 const {env,guest,owner}=await ready();await accept(guest);await upload(guest);const id=(await list(owner)).collection_library.images[0].id;
 env.DB.raw.exec('UPDATE collection_images SET expires=0');env.DB.raw.prepare('UPDATE collection_consents SET expires=?').run(Math.floor(Date.now()/1000)-1);
 await assert.rejects(()=>collectionImage(env,id));await cleanupCollection(env);assert.equal(count(env),0);assert.equal(env.DB.raw.prepare('SELECT erased FROM collection_consents').get().erased,1);
});
test('full storage preserves recognition uploads; deletion frees capacity and retry then succeeds',async()=>{
 const {env,guest,owner}=await ready();await accept(guest);await upload(guest);const id=(await list(owner)).collection_library.images[0].id;
 env.DB.raw.prepare('UPDATE collection_images SET bytes=?').run(STORAGE_LIMIT);
 const photo=(await upload(guest)).photos[1];assert.equal(photo.collection_status,'failed');assert.equal(count(env),1);
 await owner.json('/api/collection-delete',{ids:[id],admin_token:owner.token});assert.equal((await guest.json('/api/collection-retry',{id:photo.id})).photos[1].collection_status,'sent');assert.equal(count(env),1);
});
test('simultaneous uploads cannot exceed image capacity',async()=>{
 const {env,guest}=await ready();await accept(guest);const hash=env.DB.raw.prepare('SELECT receipt_hash FROM collection_consents').get().receipt_hash;
 const time=Math.floor(Date.now()/1000),item=env.DB.raw.prepare("INSERT INTO collection_items VALUES(?,?,?,'sent',?)"),image=env.DB.raw.prepare('INSERT INTO collection_images VALUES(?,?,?,1,16,16,?,?)');
 for(let i=0;i<IMAGE_LIMIT-1;i++){const id=i.toString(16).padStart(24,'0');item.run(id,hash,'fixture-'+i,time);image.run(id,hash,'synthetic-only',time,time+3600);}
 const other=browser(env,noNetwork);await other.open();await accept(other);
 const results=await Promise.all([upload(guest),upload(other)]);assert.equal(results.filter(r=>r.photos[0].collection_status==='sent').length,1);assert.equal(count(env),IMAGE_LIMIT);
});
test('withdrawal racing an in-flight encryption/upload cannot recreate the photo',async()=>{
 const {env,guest}=await ready(),code=await accept(guest);let release,started;
 const gate=new Promise(r=>release=r),entered=new Promise(r=>started=r),original=env.DB.prepare.bind(env.DB);
 env.DB.prepare=sql=>{const statement=original(sql);if(sql.startsWith('INSERT INTO collection_images')){const run=statement.run.bind(statement);statement.run=async()=>{started();await gate;return run();};}return statement;};
 const uploading=upload(guest);await entered;const later=browser(env,noNetwork);await later.open();assert.equal((await later.json('/api/collection-withdraw',{code})).status,200);release();await uploading;assert.equal(count(env),0);
});
test('withdrawal is atomic: database failure rolls back both the consent update and deletion',async()=>{
 const {env,guest}=await ready();await accept(guest);await upload(guest);const prepare=env.DB.prepare.bind(env.DB);
 env.DB.prepare=sql=>{const statement=prepare(sql);if(sql==='DELETE FROM collection_images WHERE receipt_hash=?')statement.runSync=()=>{throw new Error('synthetic DB fault');};return statement;};
 assert.equal((await guest.json('/api/collection-withdraw',{})).status,500);assert.equal(count(env),1);assert.equal(env.DB.raw.prepare('SELECT revoked FROM collection_consents').get().revoked,0);
});
test('pagination is bounded; bulk deletion validates IDs and supports multiple images',async()=>{
 const {guest,owner}=await ready();await accept(guest);await upload(guest);await upload(guest);
 assert.equal((await owner.json('/api/collection-list',{page:-1,admin_token:owner.token})).status,400);
 assert.equal((await owner.json('/api/collection-delete',{ids:["' OR 1=1"],admin_token:owner.token})).status,400);
 const ids=(await list(owner)).collection_library.images.map(p=>p.id);assert.equal((await owner.json('/api/collection-delete',{ids,admin_token:owner.token})).collection_deletion.deleted,2);
 assert.equal((await list(owner)).collection_library.total,0);
});
test('disabling new collection still permits withdrawal; ownership cannot change silently under active consent',async()=>{
 const {env,owner,guest}=await ready(),code=await accept(guest);await upload(guest);
 assert.equal((await owner.json('/api/collection-settings',{enabled:true,controller:'Another controller',admin_token:owner.token})).status,400);
 assert.equal((await owner.json('/api/collection-settings',{enabled:false,admin_token:owner.token})).status,200);
 await upload(guest);assert.equal(count(env),1);assert.equal((await guest.json('/api/collection-withdraw',{code})).status,200);assert.equal(count(env),0);
});
test('cross-origin consent, invalid deletion code and private-photo guessing are rejected',async()=>{
 const {guest}=await ready();assert.equal((await guest.json('/api/collection-consent',consent,{Origin:'https://evil.example'})).status,403);
 assert.equal((await guest.json('/api/collection-withdraw',{code:'bad'})).status,400);assert.equal((await guest.json('/api/collection-withdraw',{code:'a'.repeat(48)})).status,404);
 assert.equal((await guest.json('/api/collection-retry',{id:'b'.repeat(24)})).status,404);
});
