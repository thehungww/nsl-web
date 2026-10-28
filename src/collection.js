import { UserError, encrypt, decrypt, randomHex, bytesToBase64 } from './security.js';
import { jpegInfo } from './core.js';

export const POLICY_VERSION = '2026-10-28-web-v3';
export const RETENTION_DAYS = 90;
export const STORAGE_LIMIT = 100 * 1024 * 1024;
export const IMAGE_LIMIT = 500;
export const PAGE_SIZE = 24;
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
async function config(env) {
  const row=await env.DB.prepare("SELECT value FROM settings WHERE key='collection_web_config'").first();
  return row?JSON.parse(row.value):{enabled:true,controller:'Quản trị viên website Nhận diện mụn',contact:'Dùng mã xóa ảnh tại mục Quyền riêng tư & đóng góp ảnh trên website.'};
}
export async function collectionState(env,session) {
  const settings=await config(env);
  const consent=session.collection?.receipt_hash?await env.DB.prepare('SELECT revoked,expires,erased,policy_version,storage FROM collection_consents WHERE receipt_hash=?').bind(session.collection.receipt_hash).first():null;
  return {available:settings.enabled,configured:true,storage:'web',policy_version:POLICY_VERSION,retention_days:RETENTION_DAYS,
    controller:settings.controller,contact:settings.contact,
    decision:consent && consent.policy_version!==POLICY_VERSION?'':session.collection?.decision || '',
    accepted:!!(settings.enabled && session.collection?.decision==='accepted' && consent && consent.storage==='web' && consent.policy_version===POLICY_VERSION && !consent.revoked && consent.expires>stamp()),
    revoked:!!consent?.revoked,erased:!!consent?.erased};
}
export async function configureCollection(env,body) {
  if(typeof body.enabled!=='boolean')throw new UserError('Trạng thái thu ảnh không hợp lệ.');
  const previous=await config(env);
  const controller=typeof body.controller==='string'?body.controller.trim():previous.controller;
  const contact=typeof body.contact==='string'?body.contact.trim():previous.contact;
  if(!controller || controller.length>120 || !contact || contact.length>200)throw new UserError('Nhập tên người quản lý và cách liên hệ hợp lệ.');
  if(controller!==previous.controller || contact!==previous.contact) {
    const active=await env.DB.prepare("SELECT COUNT(*) AS n FROM collection_consents WHERE storage='web' AND revoked=0 AND expires>?").bind(stamp()).first();
    if(active.n)throw new UserError('Còn lượt đồng ý hiệu lực. Xử lý các lượt đóng góp trước khi đổi thông tin đơn vị quản lý.');
  }
  await env.DB.prepare("INSERT INTO settings(key,value) VALUES('collection_web_config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({enabled:body.enabled,controller,contact})).run();
}
export async function recordConsent(env,session,body) {
  if(typeof body.accepted!=='boolean')throw new UserError('Cần chọn đồng ý hoặc không đóng góp.');
  if(!body.accepted){session.collection={...session.collection,decision:'declined'};return null;}
  const settings=await config(env);
  if(!settings.enabled)throw new UserError('Thu ảnh đóng góp đang tắt.',409);
  if(body.policy_version!==POLICY_VERSION || body.storage!=='web')throw new UserError('Thông tin lưu ảnh đã thay đổi. Tải lại trang để đọc và đồng ý nội dung mới.');
  if(body.self_image!==true)throw new UserError('Cần xác nhận ảnh của chính mình và đồng ý nội dung hiện tại.');
  if((await collectionState(env,session)).accepted)throw new UserError('Phiên này đã đồng ý đóng góp.');
  const code=randomHex(),hash=await receiptHash(code),created=stamp(),expires=created+RETENTION_DAYS*86400;
  await env.DB.prepare("INSERT INTO collection_consents(receipt_hash,policy_version,created,expires,sink,storage) VALUES(?,?,?,?,?,'web')").bind(hash,POLICY_VERSION,created,expires,await encrypt(JSON.stringify({storage:'web',controller:settings.controller,contact:settings.contact}),env.APP_SECRET)).run();
  session.collection={decision:'accepted',receipt_hash:hash,created,expires};return code;
}
export async function collectPhoto(env,session,photo,data) {
  const settings=await config(env),hash=session.collection?.receipt_hash;
  if(!settings.enabled || session.collection?.decision!=='accepted' || !hash || photo.donation_receipt!==hash)return;
  const consent=await env.DB.prepare('SELECT * FROM collection_consents WHERE receipt_hash=?').bind(hash).first();
  if(!consent || consent.storage!=='web' || consent.policy_version!==POLICY_VERSION || consent.revoked || consent.expires<=stamp())return;
  let item=await env.DB.prepare('SELECT id,status FROM collection_items WHERE receipt_hash=? AND photo_id=?').bind(hash,photo.id).first();
  if(item?.status==='sent' || item?.status==='deleted'){photo.collection_status=item.status;return;}
  if(!item) {
    item={id:randomHex(12)};
    await env.DB.prepare('INSERT INTO collection_items(id,receipt_hash,photo_id,status,created) VALUES(?,?,?,?,?) ON CONFLICT(receipt_hash,photo_id) DO NOTHING').bind(item.id,hash,photo.id,'pending',stamp()).run();
    item=await env.DB.prepare('SELECT id,status FROM collection_items WHERE receipt_hash=? AND photo_id=?').bind(hash,photo.id).first();
  }
  try {
    const clean=photoWithoutMetadata(data),info=jpegInfo(clean),encrypted=await encrypt(clean,env.APP_SECRET),time=stamp();
    // Check capacity and current consent in the same atomic admission statement.
    await env.DB.prepare(`INSERT INTO collection_images(id,receipt_hash,data,bytes,width,height,created,expires)
      SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM collection_images)<?
      AND (SELECT COALESCE(SUM(bytes),0) FROM collection_images)+?<=?
      AND EXISTS(SELECT 1 FROM collection_consents WHERE receipt_hash=? AND storage='web' AND revoked=0 AND expires>? AND policy_version=?)
      AND EXISTS(SELECT 1 FROM collection_items WHERE id=? AND status!='deleted')
      ON CONFLICT(id) DO NOTHING`).bind(item.id,hash,encrypted,encrypted.length,info.width,info.height,time,consent.expires,IMAGE_LIMIT,encrypted.length,STORAGE_LIMIT,hash,time,POLICY_VERSION,item.id).run();
    await env.DB.prepare("UPDATE collection_items SET status='sent' WHERE id=? AND EXISTS(SELECT 1 FROM collection_images WHERE id=?)").bind(item.id,item.id).run();
    const current=await env.DB.prepare('SELECT status FROM collection_items WHERE id=?').bind(item.id).first();
    photo.collection_status=['sent','deleted'].includes(current?.status)?current.status:'failed';
    if(photo.collection_status==='failed')await env.DB.prepare("UPDATE collection_items SET status='failed' WHERE id=? AND status!='deleted'").bind(item.id).run();
  } catch {
    photo.collection_status='failed';
    await env.DB.prepare("UPDATE collection_items SET status='failed' WHERE id=? AND status!='deleted'").bind(item.id).run();
  }
}
export async function withdrawCollection(env,session,body) {
  let hash;
  if(body.code) {
    if(typeof body.code!=='string' || !/^[a-f0-9]{48}$/.test(body.code))throw new UserError('Mã xóa ảnh gồm 48 ký tự được cấp khi đồng ý.');
    hash=await receiptHash(body.code);
  } else hash=session.collection?.receipt_hash;
  if(!hash)throw new UserError('Nhập mã xóa ảnh đã lưu.');
  const record=await env.DB.prepare('SELECT storage FROM collection_consents WHERE receipt_hash=?').bind(hash).first();
  if(!record)throw new UserError('Không tìm thấy lượt đóng góp theo mã này.',404);
  if(record.storage!=='web')throw new UserError('Mã thuộc phương thức lưu trữ cũ. Liên hệ người quản lý để xử lý.',409);
  await env.DB.batch([
    env.DB.prepare('UPDATE collection_consents SET revoked=1,erased=1 WHERE receipt_hash=?').bind(hash),
    env.DB.prepare('DELETE FROM collection_images WHERE receipt_hash=?').bind(hash)
  ]);
  if(session.collection?.receipt_hash===hash)session.collection.decision='withdrawn';
  return {erased:true};
}
export async function cleanupCollection(env) {
  await env.DB.batch([
    env.DB.prepare("UPDATE collection_consents SET revoked=1,erased=1 WHERE storage='web' AND expires<=?").bind(stamp()),
    env.DB.prepare('DELETE FROM collection_images WHERE expires<=? OR receipt_hash IN (SELECT receipt_hash FROM collection_consents WHERE revoked=1)').bind(stamp()),
    env.DB.prepare("DELETE FROM collection_consents WHERE storage='web' AND erased=1 AND expires<?").bind(stamp()-30*86400)
  ]);
}
export async function listCollection(env,body) {
  if(body.page!==undefined && (!Number.isInteger(body.page) || body.page<0 || body.page>1000))throw new UserError('Trang kho ảnh không hợp lệ.');
  await cleanupCollection(env);
  const stats=await env.DB.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM collection_images').first();
  const pages=Math.max(1,Math.ceil(stats.count/PAGE_SIZE)),page=Math.min(body.page || 0,pages-1);
  const images=(await env.DB.prepare('SELECT id,width,height,bytes,created,expires FROM collection_images ORDER BY created DESC,id DESC LIMIT ? OFFSET ?').bind(PAGE_SIZE,page*PAGE_SIZE).all()).results;
  return {images,page,pages,total:stats.count,used_bytes:stats.bytes,limit_bytes:STORAGE_LIMIT,max_images:IMAGE_LIMIT};
}
export async function collectionImage(env,id) {
  if(typeof id!=='string' || !/^[a-f0-9]{24}$/.test(id))throw new UserError('Không tìm thấy ảnh.',404);
  const row=await env.DB.prepare(`SELECT i.data FROM collection_images i JOIN collection_consents c ON c.receipt_hash=i.receipt_hash
    WHERE i.id=? AND i.expires>? AND c.revoked=0`).bind(id,stamp()).first();
  if(!row)throw new UserError('Ảnh đã bị xóa hoặc hết hạn.',404);
  return jpegInfo(await decrypt(row.data,env.APP_SECRET)).bytes;
}
export async function deleteCollection(env,body) {
  const ids=body.ids;
  if(!Array.isArray(ids) || !ids.length || ids.length>PAGE_SIZE || ids.some(id=>typeof id!=='string' || !/^[a-f0-9]{24}$/.test(id)))throw new UserError('Chọn từ 1 đến 24 ảnh hợp lệ.');
  const result=await env.DB.prepare(`DELETE FROM collection_images WHERE id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).run();
  return {deleted:result.meta.changes};
}
