import { UserError, encrypt, decrypt, randomHex, bytesToBase64 } from './security.js';
import { jpegInfo } from './core.js';

export const POLICY_VERSION = '2026-10-28-v2';
export const RETENTION_DAYS = 90;
const stamp = () => Math.floor(Date.now()/1000);
const encoder = new TextEncoder();
export function photoWithoutMetadata(data) {
  const {bytes}=jpegInfo(data),parts=[bytes.slice(0,2)];let p=2,sawScan=false;
  while(p+1<bytes.length) {
    const start=p;if(bytes[p++]!==255)throw new Error('jpeg');
    while(bytes[p]===255)p++;const marker=bytes[p++];
    if(marker===218) {
      if(bytes.at(-2)!==255 || bytes.at(-1)!==217)throw new Error('jpeg');
      parts.push(bytes.slice(start));sawScan=true;break;
    }
    const length=bytes[p]*256+bytes[p+1];if(length<2 || p+length>bytes.length)throw new Error('jpeg');
    if(!(marker>=224 && marker<=239) && marker!==254)parts.push(bytes.slice(start,p+length));
    p+=length;
  }
  if(!sawScan)throw new Error('jpeg');
  const total=parts.reduce((n,b)=>n+b.length,0),clean=new Uint8Array(total);let offset=0;
  for(const part of parts){clean.set(part,offset);offset+=part.length;}
  return bytesToBase64(clean);
}
export async function receiptHash(code) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(code))),b=>b.toString(16).padStart(2,'0')).join('');
}
export function driveEndpoint(value) {
  let url;try {url=new URL(value);} catch {throw new UserError('URL Google Apps Script không hợp lệ.');}
  if(url.origin!=='https://script.google.com' || !/^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname) || url.search || url.hash || url.username || url.password)
    throw new UserError('Dùng URL triển khai https://script.google.com/macros/s/…/exec.');
  return url.href;
}
async function config(env) {
  const row=await env.DB.prepare("SELECT value FROM settings WHERE key='collection_config'").first();
  return row ? JSON.parse(await decrypt(row.value,env.APP_SECRET)) : null;
}
// Apps Script ContentService returns a GET redirect. Never forward a POST body,
// secret, or image to an arbitrary Location; restrict the only allowed host.
export async function driveCall(sink,action,payload={},fetcher=fetch) {
  try {
    let result=await fetcher(driveEndpoint(sink.url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:sink.secret,action,...payload}),redirect:'manual',signal:AbortSignal.timeout(20000)});
    if([301,302,303].includes(result.status)) {
      const location=new URL(result.headers.get('Location'));
      await result.body?.cancel();
      if(location.origin!=='https://script.googleusercontent.com' || location.pathname!=='/macros/echo' || location.username || location.password || location.hash) throw new Error('redirect');
      result=await fetcher(location.href,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(20000)});
    }
    if(!result.ok) {await result.body?.cancel();throw new Error('http');}
    const reader=result.body.getReader();let content='',size=0;const decoder=new TextDecoder();
    while(true) {const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();throw new Error('size');}content+=decoder.decode(part.value,{stream:true});}
    const body=JSON.parse(content+decoder.decode());
    if(body?.ok!==true || body.protocol!=='acne-drive-v1') throw new Error('protocol');
    return body;
  } catch {throw new UserError('Chưa kết nối được kho ảnh Google Drive. Ảnh vẫn dùng để nhận diện; chưa xác nhận được việc đóng góp.',502);}
}
export async function collectionState(env,session) {
  const settings=await config(env);
  const consent=session.collection?.receipt_hash ? await env.DB.prepare('SELECT revoked,expires,erased,policy_version FROM collection_consents WHERE receipt_hash=?').bind(session.collection.receipt_hash).first() : null;
  return {available:!!settings?.enabled,configured:!!settings,policy_version:POLICY_VERSION,retention_days:RETENTION_DAYS,
    controller:settings?.controller || '',contact:settings?.contact || '',
    decision:consent && consent.policy_version!==POLICY_VERSION?'':session.collection?.decision || '',
    accepted:!!(settings?.enabled && session.collection?.decision==='accepted' && consent && consent.policy_version===POLICY_VERSION && !consent.revoked && consent.expires>stamp()),
    revoked:!!consent?.revoked,erased:!!consent?.erased,
    endpoint:session.admin_until>stamp()?settings?.url || '':undefined};
}
export async function configureCollection(env,body,fetcher) {
  if(typeof body.enabled!=='boolean') throw new UserError('Trạng thái thu ảnh không hợp lệ.');
  const previous=await config(env);
  // Switching collection off must work even when Drive is unavailable.
  if(!body.enabled) {
    if(previous) await env.DB.prepare("UPDATE settings SET value=? WHERE key='collection_config'").bind(await encrypt(JSON.stringify({...previous,enabled:false}),env.APP_SECRET)).run();
    return;
  }
  const url=driveEndpoint(body.url),secret=body.secret || (previous?.url===url?previous.secret:'');
  const controller=typeof body.controller==='string'?body.controller.trim():'',contact=typeof body.contact==='string'?body.contact.trim():'';
  if(!/^[A-Za-z0-9_-]{32,160}$/.test(secret) || !controller || controller.length>120 || !contact || contact.length>200)
    throw new UserError('Nhập tên đơn vị/người quản lý, cách liên hệ và mã kết nối ít nhất 32 ký tự.');
  const sink={url,secret,controller,contact,enabled:true};
  const check=await driveCall(sink,'ping',{},fetcher);
  if(check.private!==true || check.retention_days!==RETENTION_DAYS) throw new UserError('Kho ảnh cần riêng tư và có lịch dọn ảnh 90 ngày.',502);
  // Existing consents remain tied to their original recipient and connection.
  if(previous && (previous.url!==url || previous.secret!==secret || previous.controller!==controller || previous.contact!==contact)) {
    const active=await env.DB.prepare('SELECT COUNT(*) AS n FROM collection_consents WHERE revoked=0 AND expires>?').bind(stamp()).first();
    if(active.n) throw new UserError('Còn đồng ý đang hiệu lực. Tắt thu ảnh và xử lý các lượt đóng góp trước khi đổi đơn vị hoặc kết nối.');
  }
  await env.DB.prepare("INSERT INTO settings(key,value) VALUES('collection_config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(await encrypt(JSON.stringify(sink),env.APP_SECRET)).run();
}
export async function recordConsent(env,session,body) {
  if(typeof body.accepted!=='boolean') throw new UserError('Cần chọn đồng ý hoặc không đóng góp.');
  if(!body.accepted) {session.collection={...session.collection,decision:'declined'};return null;}
  const sink=await config(env);
  if(!sink?.enabled) throw new UserError('Thu ảnh đóng góp chưa được bật.',409);
  if(body.policy_version!==POLICY_VERSION || body.self_image!==true) throw new UserError('Cần xác nhận ảnh của chính mình và đồng ý nội dung hiện tại.');
  if((await collectionState(env,session)).accepted) throw new UserError('Phiên này đã đồng ý đóng góp.');
  const code=randomHex(),hash=await receiptHash(code),created=stamp(),expires=created+RETENTION_DAYS*86400;
  await env.DB.prepare('INSERT INTO collection_consents(receipt_hash,policy_version,created,expires,sink) VALUES(?,?,?,?,?)').bind(hash,POLICY_VERSION,created,expires,await encrypt(JSON.stringify(sink),env.APP_SECRET)).run();
  session.collection={decision:'accepted',receipt_hash:hash,created,expires};
  // A capability to withdraw is returned once. Never publish it in state or logs.
  return code;
}
export async function collectPhoto(env,session,photo,data,fetcher) {
  const settings=await config(env),hash=session.collection?.receipt_hash;
  if(!settings?.enabled || session.collection?.decision!=='accepted' || !hash || photo.donation_receipt!==hash) return;
  const consent=await env.DB.prepare('SELECT * FROM collection_consents WHERE receipt_hash=?').bind(hash).first();
  if(!consent || consent.policy_version!==POLICY_VERSION || consent.revoked || consent.expires<=stamp()) return;
  let item=await env.DB.prepare('SELECT id,status FROM collection_items WHERE receipt_hash=? AND photo_id=?').bind(hash,photo.id).first();
  if(item?.status==='sent') {photo.collection_status='sent';return;}
  if(!item) {
    item={id:randomHex(12)};
    await env.DB.prepare('INSERT INTO collection_items(id,receipt_hash,photo_id,status,created) VALUES(?,?,?,?,?)').bind(item.id,hash,photo.id,'pending',stamp()).run();
  }
  try {
    jpegInfo(data);
    const result=await driveCall(JSON.parse(await decrypt(consent.sink,env.APP_SECRET)),'upload',{
      receipt_hash:hash,id:item.id,data:photoWithoutMetadata(data),consent:{version:POLICY_VERSION,accepted_at:consent.created,expires_at:consent.expires,self_image:true}
    },fetcher);
    if(result.id!==item.id) throw new Error('id');
    photo.collection_status='sent';
    await env.DB.prepare("UPDATE collection_items SET status='sent' WHERE id=?").bind(item.id).run();
  } catch {
    photo.collection_status='failed';
    await env.DB.prepare("UPDATE collection_items SET status='failed' WHERE id=?").bind(item.id).run();
  }
}
export async function withdrawCollection(env,session,body,fetcher) {
  let hash;
  if(body.code) {
    if(typeof body.code!=='string' || !/^[a-f0-9]{48}$/.test(body.code)) throw new UserError('Mã xóa ảnh gồm 48 ký tự được cấp khi đồng ý.');
    hash=await receiptHash(body.code);
  } else hash=session.collection?.receipt_hash;
  if(!hash) throw new UserError('Nhập mã xóa ảnh đã lưu.');
  const record=await env.DB.prepare('SELECT * FROM collection_consents WHERE receipt_hash=?').bind(hash).first();
  if(!record) throw new UserError('Không tìm thấy lượt đóng góp theo mã này.',404);
  // Stop uploads first, even if Drive is temporarily unavailable. Apps Script also
  // serializes upload and delete and keeps a tombstone to prevent late arrivals.
  await env.DB.prepare('UPDATE collection_consents SET revoked=1 WHERE receipt_hash=?').bind(hash).run();
  if(session.collection?.receipt_hash===hash) session.collection.decision='withdrawn';
  if(!record.erased) {
    let result;
    try {result=await driveCall(JSON.parse(await decrypt(record.sink,env.APP_SECRET)),'withdraw',{receipt_hash:hash,expires_at:record.expires},fetcher);}
    catch {throw new UserError('Đã dừng thu thêm; chưa xác nhận xóa trên Drive. Giữ mã, thử lại hoặc liên hệ người quản lý. Hệ thống sẽ thử xóa lại theo lịch.',502);}
    if(result.erased!==true) throw new UserError('Đã dừng thu thêm; chưa xác nhận xóa trên Drive. Giữ mã và thử lại.',502);
    await env.DB.prepare('UPDATE collection_consents SET erased=1 WHERE receipt_hash=?').bind(hash).run();
  }
  return {erased:true};
}
export async function cleanupCollection(env,fetcher=fetch) {
  const rows=(await env.DB.prepare('SELECT receipt_hash FROM collection_consents WHERE erased=0 AND (revoked=1 OR expires<=?) LIMIT 10').bind(stamp()).all()).results;
  for(const row of rows) {
    try {await withdrawCollection(env,{collection:{receipt_hash:row.receipt_hash}}, {},fetcher);} catch {/* retry next hour; never log images or credentials */}
  }
  await env.DB.prepare('DELETE FROM collection_consents WHERE erased=1 AND expires<?').bind(stamp()-30*86400).run();
}
