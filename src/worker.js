import { UserError, randomHex, equal, encrypt, decrypt, passwordHash, endpoint } from './security.js';
import { jpegInfo, parsePrediction, invalidate, imageContext, annotatedSvg } from './core.js';
import { documents, reply } from './rag.js';

const now = () => Math.floor(Date.now()/1000);
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
const adminRoutes = new Set(['/api/add-remote-model','/api/delete-remote-model','/api/chat-settings','/api/delete-chat-key']);
function response(body, type = 'application/json; charset=utf-8', status = 200, headers = {}) {
  return new Response(body,{status,headers:{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Content-Security-Policy':CSP,...headers}});
}
const json = (value,status=200,headers={}) => response(JSON.stringify(value),undefined,status,headers);
async function setting(db,key) { return (await db.prepare('SELECT value FROM settings WHERE key=?').bind(key).first())?.value || ''; }
async function putSetting(db,key,value) { await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value).run(); }
async function save(env,session) {
  const data=JSON.stringify(session);
  if (data.length > 900000) throw new UserError('Phiên quá lớn. Bắt đầu đoạn chat mới hoặc bỏ bớt ảnh.');
  await env.DB.prepare('UPDATE sessions SET data=?, expires=? WHERE id=?').bind(data,now()+3600,session.id).run();
}
async function sessionFor(request,env,create=false) {
  const match=(request.headers.get('Cookie') || '').match(/(?:^|;\s*)nsl_session=([a-f0-9]{48})(?:;|$)/);
  const row=match && await env.DB.prepare('SELECT data,expires,lock_until FROM sessions WHERE id=?').bind(match[1]).first();
  if (row && row.expires > now()) return {session:JSON.parse(row.data),locked:row.lock_until > now(),cookie:''};
  if (!create) throw new UserError('Phiên đã hết hạn. Tải lại trang để tiếp tục.',401);
  await env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now()).run();
  const total=await env.DB.prepare('SELECT COUNT(*) AS total FROM sessions').first();
  if (total.total >= 64) throw new UserError('Web đang phục vụ nhiều người. Thử lại sau.',429);
  const session={id:randomHex(),csrf:randomHex(),photos:[],chats:{general:[],image:[]},image_context:null,selected_model:'',admin_until:0,admin_token:'',status:'Sẵn sàng',error:''};
  await env.DB.prepare('INSERT INTO sessions(id,data,expires) VALUES(?,?,?)').bind(session.id,JSON.stringify(session),now()+3600).run();
  const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
  return {session,locked:false,cookie:`nsl_session=${session.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${secure}`};
}
async function publicState(env,session,locked=false) {
  const models=(await env.DB.prepare('SELECT id,name,endpoint FROM models ORDER BY rowid').all()).results;
  if (!locked && session.selected_model && !models.some(m=>m.id===session.selected_model)) {
    invalidate(session); session.selected_model=''; session.status='Mô hình đã bị xóa. Chọn mô hình khác rồi quét lại.'; await save(env,session);
  }
  const configured=!!await setting(env.DB,'admin');
  return {shared:true,remote_only:true,models:[],selected_model:session.selected_model,
    remote:{models,configured:models.length>0,endpoint:models[0]?.endpoint || ''},
    chat:{configured:!!await setting(env.DB,'chat_key'),model:env.GEMINI_MODEL || 'gemini-3.5-flash-lite'},
    admin:{configured,logged_in:session.admin_until>now(),requires_setup_token:true},
    photos:session.photos.map(p=>({id:p.id,name:p.name,width:p.width,height:p.height,error:p.error || '',revision:p.revision,scanned:!!p.result,...(p.result || {})})),
    chats:session.chats,job:{busy:locked,status:session.status,error:session.error || ''}};
}
async function rate(env,key,max,seconds=60) {
  const stamp=now(),bucket=Math.floor(stamp/seconds),id=`${key}:${bucket}`;
  const row=await env.DB.prepare('INSERT INTO rates(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(id,stamp+seconds*2).first();
  if (row.count>max) throw new UserError('Bạn đang thao tác quá nhanh. Thử lại sau khoảng một phút.',429);
}
async function bodyOf(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new UserError('Yêu cầu phải là JSON.',415);
  const declared=Number(request.headers.get('Content-Length') || 0);
  if (declared>1250000) throw new UserError('Yêu cầu quá lớn.',413);
  const reader=request.body?.getReader(); if (!reader) throw new UserError('Thiếu nội dung yêu cầu.');
  const chunks=[]; let length=0;
  while(true) { const {done,value}=await reader.read(); if(done) break; length+=value.length; if(length>1250000) { await reader.cancel(); throw new UserError('Yêu cầu quá lớn.',413); } chunks.push(value); }
  const all=new Uint8Array(length);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
  let body; try { body=JSON.parse(new TextDecoder().decode(all)); } catch { throw new UserError('JSON không hợp lệ.'); }
  if (!body || Array.isArray(body) || typeof body!=='object') throw new UserError('JSON không hợp lệ.'); return body;
}
function threshold(value) { if (typeof value!=='number' || !Number.isFinite(value) || value<.01 || value>.95) throw new UserError('Ngưỡng tin cậy không hợp lệ.'); return value; }
function requireAdmin(session,body) { if(session.admin_until<=now() || !equal(session.admin_token,body.admin_token)) throw new UserError('Chỉ admin được quản lý API key và mô hình.',403); }
async function predict(env,record,photo,data,confidence,fetcher) {
  const bytes=jpegInfo(data).bytes,key=await decrypt(record.encrypted_key,env.APP_SECRET);
  const form=new FormData(); form.append('file',new Blob([bytes],{type:'image/jpeg'}),'image.jpg');
  for(const [k,v] of Object.entries({conf:confidence,iou:.45,imgsz:640,normalize:'false'})) form.append(k,String(v));
  let result; const started=performance.now();
  try { result=await fetcher(endpoint(record.endpoint)+'/predict',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,redirect:'error',signal:AbortSignal.timeout(120000)}); }
  catch { throw new UserError('Không kết nối được máy chủ nhận diện.',502); }
  if(!result.ok) { await result.body?.cancel(); throw new UserError(({401:'API key Ultralytics không hợp lệ.',403:'Deployment từ chối API key.',429:'Máy chủ nhận diện đạt hạn mức.'})[result.status] || 'Máy chủ nhận diện tạm thời lỗi.',502); }
  return parsePrediction(await result.json(),photo,confidence,(performance.now()-started)/1000);
}
async function mutate(path,body,env,session,request,fetcher) {
  if(adminRoutes.has(path)) requireAdmin(session,body);
  if(path==='/api/admin-logout') { session.admin_until=0;session.admin_token='';return; }
  if(path==='/api/admin-setup') {
    if(!env.ADMIN_SETUP_TOKEN || !equal(body.setup_token,env.ADMIN_SETUP_TOKEN)) throw new UserError('Cần mã thiết lập riêng của chủ web để tạo admin.',403);
    if(typeof body.password!=='string' || body.password.length<8 || body.password.length>256 || body.password!==body.confirmation) throw new UserError('Mật khẩu từ 8 đến 256 ký tự và phải nhập lại đúng.');
    const salt=randomHex(16),hash=await passwordHash(body.password,salt);
    const result=await env.DB.prepare("INSERT INTO settings(key,value) VALUES('admin',?) ON CONFLICT(key) DO NOTHING").bind(JSON.stringify({salt,hash})).run();
    if(!result.meta.changes) throw new UserError('Admin đã được tạo. Hãy đăng nhập.');
    session.status='Đã tạo tài khoản admin. Đăng nhập để quản lý.';return;
  }
  if(path==='/api/admin-login') {
    await rate(env,'login:'+ (request.headers.get('CF-Connecting-IP') || session.id),5);
    const value=await setting(env.DB,'admin'); if(!value) throw new UserError('Chủ web chưa thiết lập admin.');
    if(typeof body.password!=='string' || body.password.length>256) throw new UserError('Mật khẩu không hợp lệ.');
    const account=JSON.parse(value);
    if(body.username!=='admin' || !equal(await passwordHash(body.password,account.salt),account.hash)) throw new UserError('Sai tài khoản hoặc mật khẩu.',403);
    session.admin_until=now()+1800;session.admin_token=randomHex();session.status='Đã đăng nhập admin.';return;
  }
  if(path==='/api/add-remote-model') {
    const name=typeof body.name==='string'?body.name.trim():'';
    if(!name || name.length>80 || !/^ul_[A-Za-z0-9_-]{8,250}$/.test(body.key || '')) throw new UserError('Tên tối đa 80 ký tự và API key Ultralytics bắt đầu bằng ul_.');
    const records=(await env.DB.prepare('SELECT id,name FROM models').all()).results;
    if(records.length>=30) throw new UserError('Danh sách tối đa 30 mô hình.');
    if(records.some(m=>m.name.toLowerCase()===name.toLowerCase())) throw new UserError('Tên mô hình đã tồn tại.');
    await env.DB.prepare('INSERT INTO models(id,name,endpoint,encrypted_key) VALUES(?,?,?,?)').bind(randomHex(12),name,endpoint(body.endpoint),await encrypt(body.key,env.APP_SECRET)).run();
    session.status='Đã thêm mô hình vào danh sách dùng chung.';return;
  }
  if(path==='/api/delete-remote-model') { await env.DB.prepare('DELETE FROM models WHERE id=?').bind(String(body.id || '')).run();return; }
  if(path==='/api/chat-settings') {
    const key=typeof body.key==='string'?body.key.trim():'';
    if(key && (key.length<8 || key.length>512 || /[\s\x00-\x1f]/.test(key))) throw new UserError('API key không hợp lệ.');
    if(key) await putSetting(env.DB,'chat_key',await encrypt(key,env.APP_SECRET));
    session.status='Đã lưu cấu hình chatbot dùng chung.';return;
  }
  if(path==='/api/delete-chat-key') { await env.DB.prepare("DELETE FROM settings WHERE key='chat_key'").run();return; }
  if(path==='/api/photo') {
    if(session.photos.length>=12) throw new UserError('Tối đa 12 ảnh mỗi phiên.');
    const {width,height}=jpegInfo(body.data),id=randomHex(12);
    const name=typeof body.name==='string'?body.name.slice(0,250):'Ảnh.jpg';
    await env.DB.prepare('INSERT INTO photos(id,session_id,data) VALUES(?,?,?)').bind(id,session.id,await encrypt(body.data,env.APP_SECRET)).run();
    session.photos.push({id,name,width,height,revision:0,error:''});session.chats.image=[];session.image_context=null;session.status='Ảnh đã sẵn sàng để quét.';return;
  }
  if(path==='/api/remove-photo') {
    await env.DB.prepare('DELETE FROM photos WHERE id=? AND session_id=?').bind(String(body.id || ''),session.id).run();
    session.photos=session.photos.filter(p=>p.id!==body.id);session.chats.image=[];session.image_context=null;return;
  }
  if(path==='/api/invalidate') { invalidate(session);return; }
  if(path==='/api/reset-chat') {
    if(!['general','image'].includes(body.mode)) throw new UserError('Chế độ chat không hợp lệ.');
    session.chats[body.mode]=[];if(body.mode==='image') session.image_context=null;return;
  }
  if(path==='/api/scan') {
    if(body.provider!=='remote') throw new UserError('Bản Cloudflare chỉ dùng mô hình API.');
    const conf=threshold(body.confidence),record=await env.DB.prepare('SELECT * FROM models WHERE id=?').bind(String(body.remote_model || '')).first();
    if(!record) throw new UserError('Mô hình đã bị xóa hoặc chưa được chọn.');
    if(!session.photos.length) throw new UserError('Thêm ảnh trước khi quét.');
    await rate(env,'scan:'+session.id,6);await rate(env,'global:scan',30);
    invalidate(session);session.selected_model=record.id;
    let successful=0;
    for(const photo of session.photos) {
      try {
        const stored=await env.DB.prepare('SELECT data FROM photos WHERE id=? AND session_id=?').bind(photo.id,session.id).first();
        if(!stored) throw new UserError('Ảnh đã hết hạn. Thêm lại ảnh.');
        photo.result=await predict(env,record,photo,await decrypt(stored.data,env.APP_SECRET),conf,fetcher);successful++;
      } catch(error) { photo.error=error instanceof UserError?error.message:'Không xử lý được ảnh này. Thử lại sau.'; }
      photo.revision++;
    }
    session.status=`Đã quét ${successful}/${session.photos.length} ảnh.`;
    if(!successful) session.error='Không quét được ảnh. Kiểm tra lỗi dưới từng ảnh.';return;
  }
  if(path==='/api/chat') {
    const mode=body.mode,message=typeof body.message==='string'?body.message.trim():'';
    if(!['general','image'].includes(mode) || !message || message.length>3000) throw new UserError('Câu hỏi từ 1 đến 3000 ký tự.');
    const savedKey=await setting(env.DB,'chat_key');if(!savedKey) throw new UserError('Admin cần thêm API key chatbot.');
    await rate(env,'chat:'+session.id,6);await rate(env,'global:chat',30);
    let context=null;
    if(mode==='image') {
      const exists=session.selected_model && await env.DB.prepare('SELECT id FROM models WHERE id=?').bind(session.selected_model).first();
      if(!exists) {invalidate(session);session.selected_model='';throw new UserError('Mô hình đã bị xóa. Chọn mô hình khác rồi quét lại.');}
      context=imageContext(session,body.scope,body.image_id,threshold(body.confidence));
      const marker=JSON.stringify(context);if(session.image_context!==marker) {session.chats.image=[];session.image_context=marker;}
    }
    const output=await reply(env,await decrypt(savedKey,env.APP_SECRET),context,session.chats[mode],message,fetcher);
    session.chats[mode].push({role:'user',text:message},{role:'assistant',text:output.answer,sources:output.sources});
    session.chats[mode]=session.chats[mode].slice(-20);session.status='Chatbot đã trả lời.';return;
  }
  throw new UserError('Không có chức năng này.',404);
}
export async function handle(request,env,ctx,fetcher=globalThis.fetch.bind(globalThis)) {
  const url=new URL(request.url),path=url.pathname;
  if(!env.DB) return json({error:'Chưa liên kết cơ sở dữ liệu Cloudflare. Chạy npm run setup.'},503);
  let current,cookie='',session;
  try {
    if(request.method==='GET' && ['/style.css','/app.js','/logo.jpg'].includes(path)) return env.ASSETS.fetch(request);
    if(request.method==='GET' && path==='/document') {
      const file=url.searchParams.get('file');if(!documents.some(d=>d.file===file)) throw new UserError('Không tìm thấy tài liệu.',404);
      const pdf=await env.ASSETS.fetch(new Request(url.origin+'/pdf/'+encodeURIComponent(file)));
      return new Response(pdf.body,{status:pdf.status,headers:{'Content-Type':'application/pdf','X-Content-Type-Options':'nosniff','Content-Security-Policy':"frame-ancestors 'self'",'Cache-Control':'public, max-age=3600'}});
    }
    if(request.method==='GET' && path==='/api/documents') return json({documents});
    if(request.method==='GET' && !['/','/api/state','/photo'].includes(path)) throw new UserError('Không tìm thấy trang.',404);
    current=await sessionFor(request,env,path==='/' || path==='/api/state');session=current.session;cookie=current.cookie;
    const headers=cookie?{'Set-Cookie':cookie}:{};
    if(request.method==='GET' && path==='/') {
      const html=await env.ASSETS.fetch(new Request(url.origin+'/index.html'));
      return response((await html.text()).replace('__TOKEN__',session.csrf),'text/html; charset=utf-8',200,headers);
    }
    if(request.method==='GET' && path==='/api/state') return json(await publicState(env,session,current.locked),200,headers);
    if(request.method==='GET' && path==='/photo') {
      const photo=session.photos.find(p=>p.id===url.searchParams.get('id'));if(!photo) throw new UserError('Ảnh không thuộc phiên này.',404);
      const row=await env.DB.prepare('SELECT data FROM photos WHERE id=? AND session_id=?').bind(photo.id,session.id).first();if(!row) throw new UserError('Ảnh đã hết hạn.',404);
      const data=await decrypt(row.data,env.APP_SECRET),kind=url.searchParams.get('kind');
      if(['result','download'].includes(kind) && photo.result) return response(annotatedSvg(photo,data),'image/svg+xml',200,kind==='download'?{'Content-Disposition':'attachment; filename="anh_nhan_dien.svg"'}:{});
      return response(jpegInfo(data).bytes,'image/jpeg');
    }
    if(request.method!=='POST') throw new UserError('Phương thức không hỗ trợ.',405);
    if(request.headers.get('Origin')!==url.origin || !equal(request.headers.get('X-Acne-Token'),session.csrf)) throw new UserError('Yêu cầu không xuất phát từ phiên web này.',403);
    const body=await bodyOf(request);
    const lock=await env.DB.prepare('UPDATE sessions SET lock_until=? WHERE id=? AND lock_until < ?').bind(now()+1800,session.id,now()).run();
    if(!lock.meta.changes) throw new UserError('Phiên đang xử lý. Chờ hoàn tất rồi thử lại.',409);
    try {
      // Re-read after acquiring the lock so concurrent logout/edits cannot use stale privileges.
      session=JSON.parse((await env.DB.prepare('SELECT data FROM sessions WHERE id=?').bind(session.id).first()).data);
      session.error='';
      await mutate(path,body,env,session,request,fetcher);
      await save(env,session);
      const result=await publicState(env,session,false);
      if(path==='/api/admin-login') result.admin_token=session.admin_token;
      return json(result,200,headers);
    } catch(error) { await save(env,session);throw error; }
    finally { await env.DB.prepare('UPDATE sessions SET lock_until=0 WHERE id=?').bind(session.id).run(); }
  } catch(error) {
    // Upstream errors and credentials are deliberately never returned or logged.
    return json({error:error instanceof UserError?error.message:'Máy chủ gặp lỗi. Thử lại sau.'},error instanceof UserError?error.status:500,cookie?{'Set-Cookie':cookie}:{});
  }
}
export default {
  fetch:handle,
  async scheduled(event,env,ctx) {
    await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(now()),env.DB.prepare('DELETE FROM rates WHERE expires < ?').bind(now())]);
  }
};
