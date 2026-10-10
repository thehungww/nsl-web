'use strict';
const $ = id => document.getElementById(id);
const token = document.querySelector('meta[name="acne-token"]').content;
let state = null, selected = null, view = 'original', mode = 'general', stream = null;
let adminToken='';
let localBusy = false, polling = false, messagesKey = '', galleryKey = '', imageKey = '', localError = '';
let zoom = 1, panX = 0, panY = 0, drag = null, pendingQuestion = null;
let followScan = false;
let restoredView = false;
function savedView() { try { return JSON.parse(sessionStorage.getItem('acne-view-v1')) || {}; } catch { return {}; } }
function saveView() {
  try { sessionStorage.setItem('acne-view-v1',JSON.stringify({selected,view,mode,scope:scope(),confidence:$('confidence').value,remoteModel:$('remote-model').value})); } catch {}
}
const scope = () => document.querySelector('input[name="scope"]:checked').value;
const confidence = () => Number($('confidence').value) / 100;
const provider = () => $('recognition-mode').value;
$('admin-button').onclick=async()=>{
  if(state?.admin?.logged_in && adminToken) { adminToken=''; await post('/api/admin-logout',{}); return; }
  const setup=!state?.admin?.configured;
  $('admin-title').textContent=setup ? 'Tạo mật khẩu admin' : 'Đăng nhập admin';
  $('admin-confirm-row').classList.toggle('hidden',!setup); $('setup-token-row').classList.toggle('hidden',!setup); $('setup-token').required=setup;
  $('admin-confirm').required=setup;
  $('admin-password').minLength=setup ? 8 : 1;
  $('admin-feedback').textContent='';
  $('admin-dialog').showModal();
  $('admin-password').focus();
};
$('close-admin').onclick=()=>$('admin-dialog').close();
$('admin-dialog').addEventListener('close',()=>{ $('admin-password').value=''; $('admin-confirm').value=''; $('setup-token').value=''; });
$('admin-form').onsubmit=async event=>{
  event.preventDefault();
  const submit=event.submitter; submit.disabled=true;
  try {
    const setup=!state.admin.configured;
    state=await api(setup?'/api/admin-setup':'/api/admin-login',{
      setup_token:$('setup-token').value,username:'admin',password:$('admin-password').value,confirmation:$('admin-confirm').value});
    adminToken=state.admin_token || ''; delete state.admin_token;
    if(setup) {
      $('admin-title').textContent='Đăng nhập admin';
      $('setup-token-row').classList.add('hidden'); $('setup-token').required=false; $('setup-token').value=''; $('admin-confirm-row').classList.add('hidden'); $('admin-confirm').required=false;
      $('admin-password').value=''; $('admin-confirm').value='';
      $('admin-feedback').textContent='Đã tạo tài khoản. Nhập mật khẩu để đăng nhập.';
      render(); return;
    }
    localError=''; $('admin-dialog').close(); render();
  } catch(exc) { $('admin-feedback').textContent=exc.message; }
  finally { submit.disabled=false; }
};
function text(tag, content, cls) { const element = document.createElement(tag); element.textContent = content; if(cls) element.className = cls; return element; }
async function api(path, data) {
  if(data && ['/api/upload-model','/api/delete-model','/api/remote-key','/api/delete-remote-key','/api/add-remote-model','/api/delete-remote-model','/api/chat-settings','/api/delete-chat-key'].includes(path)) data={...data,admin_token:adminToken};
  const wasBusy=localBusy;
  if(data!==undefined) { localBusy=true; if(state) { state.job.status=path==='/api/scan'?'Đang quét các ảnh…':path==='/api/chat'?'Chatbot đang trả lời…':'Đang xử lý…'; render(); } }
  try {
    const response=await fetch(path,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Acne-Token':token},body:JSON.stringify(data)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Không xử lý được yêu cầu.');return result;
  } finally { localBusy=wasBusy; }

}
function error(exc) { localError=exc.message || String(exc); $('status').textContent=localError; $('status').className='error-text'; }
function photoUrl(photo, kind='original') { return `/photo?id=${encodeURIComponent(photo.id)}&kind=${kind}`; }
function activePhoto() { return state?.photos.find(p => p.id === selected); }
function resetZoom() { zoom=1; panX=panY=0; transform(); }
function transform() { $('large-image').style.transform=`translate(${panX}px, ${panY}px) scale(${zoom})`; }
function render() {
  if(!state) return;
  const preferences=savedView();
  if(!restoredView) {
    restoredView=true;
    selected=state.photos.some(p=>p.id===preferences.selected) ? preferences.selected : state.photos[0]?.id || null;
    const photo=activePhoto();
    mode=['general','image'].includes(preferences.mode) ? preferences.mode : state.photos.some(p=>p.scanned) ? 'image' : 'general';
    view=['original','result'].includes(preferences.view) ? preferences.view : photo?.scanned ? 'result' : 'original';
    if(['one','all'].includes(preferences.scope)) document.querySelector(`input[name="scope"][value="${preferences.scope}"]`).checked=true;
    const threshold=Number(preferences.confidence ?? (photo?.scanned ? Math.round(photo.confidence*100) : 25));
    if(Number.isFinite(threshold) && threshold>=1 && threshold<=95) $('confidence').value=threshold;
    $('confidence-value').textContent=$('confidence').value+'%';
  }
  if(state.shared) document.querySelector('.local-pill').textContent='Web chia sẻ trực tuyến';
  if(state.hosted) {
    $('recognition-mode').value='remote';
    $('recognition-mode').classList.add('hidden');
    $('remote-settings').classList.add('hidden');
  }
  if(state.remote_only) {
    $('recognition-mode').value='remote';
    $('recognition-mode').classList.add('hidden');
  }
  if(!state.photos.some(p=>p.id===selected)) selected=state.photos[0]?.id || null;
  if(followScan && !state.job.busy && !localBusy) {
    followScan=false;
    const scanned=state.photos.find(p=>p.scanned);
    if(scanned) {
      mode='image'; view='result';
      if(!activePhoto()?.scanned) selected=scanned.id;
    }
  }
  const oldModel=$('model').value, choices=state.models;
  if(JSON.stringify(choices)!==$('model').dataset.choices) {
    $('model').replaceChildren(...choices.map(name=>{ const option=text('option',name); option.value=name; return option; }));
    if(!choices.length) $('model').append(text('option','Chưa có mô hình'));
    if(choices.includes(oldModel)) $('model').value=oldModel;
    else if(choices.includes(state.selected_model)) $('model').value=state.selected_model;
    $('model').dataset.choices=JSON.stringify(choices);
  }
  const busy=state.job.busy || localBusy;
  const scanning=busy && (followScan || /quét/i.test(state.job.status)) && state.photos.length>0;
  $('viewer').classList.toggle('is-scanning',!!scanning);
  $('viewer').setAttribute('aria-busy',String(!!scanning));
  const admin=!!state.admin?.logged_in && !!adminToken;
  $('admin-button').textContent=admin ? 'Đăng xuất admin' : 'Đăng nhập admin';
  $('admin-button').disabled=busy;
  $('admin-button').classList.toggle('hidden',!!state.hosted);
  const remote=provider()==='remote';
  const connections=state.remote?.models || [], oldRemote=$('remote-model').value;
  if(JSON.stringify(connections)!==$('remote-model').dataset.choices) {
    const firstLoad=$('remote-model').dataset.choices===undefined;
    const placeholder=text('option','Chọn mô hình nhận diện'); placeholder.value='';
    $('remote-model').replaceChildren(placeholder,...connections.map(item=>{const option=text('option',item.name);option.value=item.id;return option;}));
    const restoredRemote=connections.some(item=>item.id===preferences.remoteModel) ? preferences.remoteModel : state.selected_model;
    $('remote-model').value=connections.some(item=>item.id===oldRemote)?oldRemote:firstLoad && connections.length?(connections.some(item=>item.id===restoredRemote)?restoredRemote:connections[0].id):'';
    $('remote-model').dataset.choices=JSON.stringify(connections);
  }
  $('remote-model').disabled=busy || !connections.length;
  $('local-model-controls').classList.toggle('hidden',remote);
  $('remote-controls').classList.toggle('hidden',!remote);
  $('recognition-mode').disabled=busy;
  $('remote-settings').disabled=busy || !admin;
  $('chat-settings').disabled=busy || !admin;
  $('chat-settings').classList.toggle('hidden',!!state.hosted);
  $('delete-chat-key').disabled=busy || !admin || !state.chat?.configured;
  $('delete-remote-key').disabled=busy || !admin || !$('remote-model').value;
  $('remote-selected-label').textContent='Mô hình đang chọn: '+(connections.find(item=>item.id===$('remote-model').value)?.name || 'Chưa chọn');
  $('remote-note').textContent=(state.remote?.configured ? '' : 'Admin cần thêm API key. ')+'Ảnh gửi tới Ultralytics; chat dùng dịch vụ AI.';
  if(state.hosted) $('remote-note').textContent='Ảnh gửi tới Ultralytics. Câu hỏi và đoạn tài liệu liên quan gửi tới dịch vụ chatbot. Ảnh và hội thoại chỉ giữ tạm trong phiên, tự hết hạn sau 1 giờ không hoạt động.';
  for(const id of ['model','upload-model','delete-model','add-images','camera-button','empty-add','confidence','remove-image','new-chat','send','general-tab','image-chat-tab']) $(id).disabled=busy;
  document.querySelectorAll('input[name="scope"]').forEach(input=>input.disabled=busy);
  $('scan').disabled=busy || !state.photos.length || (remote ? !$('remote-model').value : !choices.length);
  $('scan').textContent=state.photos.length>1 ? `Quét ${state.photos.length} ảnh` : 'Quét ảnh';
  $('remove-image').disabled=busy || !selected;
  $('remove-image').classList.toggle('hidden',!selected);
  $('upload-model').disabled=busy || !admin;
  $('delete-model').disabled=busy || !choices.length || !admin;
  $('image-count').textContent=state.photos.length ? `${state.photos.length} ảnh · Đang xem ảnh ${state.photos.findIndex(p=>p.id===selected)+1}` : 'Chưa thêm ảnh';
  $('busy-indicator').classList.toggle('hidden',!busy);
  $('status').textContent=localError || state.job.error || state.job.status;
  $('status').className=localError || state.job.error ? 'error-text' : '';
  const photo=activePhoto(), stale=photo?.scanned && photo.confidence!==confidence();
  $('result-title').textContent=photo ? (photo.scanned ? `${photo.detections.length} vùng được phát hiện` : 'Ảnh đã sẵn sàng để quét') : 'Khám phá làn da của bạn';
  $('result-subtitle').textContent=photo ? (photo.error || (stale ? 'Ngưỡng đã đổi · Quét lại để cập nhật kết quả' : photo.scanned ? `${photo.seconds.toFixed(2)} giây · Ngưỡng ${Math.round(photo.confidence*100)}% · ${photo.name}` : photo.name)) : 'Thêm hình ảnh để bắt đầu nhận diện';
  $('result-subtitle').title=photo?.name || '';
  const nextImage=photo ? photoUrl(photo,view==='result' && photo.scanned?'result':'original')+`&revision=${photo.revision}` : '';
  if(nextImage!==imageKey) { imageKey=nextImage; if(photo) $('large-image').src=nextImage; else $('large-image').removeAttribute('src'); resetZoom(); }
  $('large-image').classList.toggle('hidden',!photo); $('empty').classList.toggle('hidden',!!photo);
  $('original-tab').classList.toggle('active',view==='original'); $('result-tab').classList.toggle('active',view==='result');
  $('save-result').classList.toggle('hidden',!photo?.scanned); if(photo?.scanned) $('save-result').href=photoUrl(photo,'download');
  const nextGallery=JSON.stringify(state.photos.map(p=>[p.id,p.scanned,p.error]));
  if(nextGallery!==galleryKey) {
    galleryKey=nextGallery; $('gallery').replaceChildren();
    state.photos.forEach((p,i)=>{ const button=document.createElement('button'); button.dataset.id=p.id; button.title=p.name;
      const image=document.createElement('img'); image.src=photoUrl(p,'thumb'); image.alt=`Ảnh ${i+1}`;
      button.append(image,text('span',`Ảnh ${i+1}${p.scanned?' ✓':p.error?' !':''}`));
      button.onclick=()=>selectPhoto(p.id); $('gallery').append(button); });
  }
  [...$('gallery').children].forEach(button=>{ button.classList.toggle('selected',button.dataset.id===selected); button.disabled=busy; });
  $('types').replaceChildren();
  if(photo?.scanned && photo.types.length) photo.types.forEach(type=>{ const row=text('div','', 'type-row'); row.append(text('span',type.name),text('strong',type.count)); $('types').append(row); });
  else $('types').append(text('p', photo?.scanned ? 'Không phát hiện vùng trên ngưỡng đã chọn; chưa đủ để khẳng định da không có mụn.' : 'Các loại mụn sẽ hiển thị sau khi quét.','help'));
  $('detections').classList.toggle('hidden',!photo?.detections?.length);
  $('detection-rows').replaceChildren(); (photo?.detections||[]).forEach((d,i)=>{ const row=document.createElement('tr'); row.append(text('td',i+1),text('td',`${d.name} / ${d.original_name}`),text('td',`${(d.confidence*100).toFixed(1)}%`)); $('detection-rows').append(row); });
  $('general-tab').classList.toggle('active',mode==='general'); $('image-chat-tab').classList.toggle('active',mode==='image');
  $('scope-controls').classList.toggle('hidden',mode!=='image');
  $('chat-note').textContent=mode==='general' ? 'Hỏi về chăm sóc da, kể cả khi chưa có ảnh. Câu trả lời bằng tiếng Việt.' : scope()==='all' ? 'Tư vấn từng góc mặt · Không cộng các vùng trùng thành tổng mụn duy nhất.' : 'Tư vấn theo ảnh đang xem · Quét ảnh trước khi hỏi.';
  const relevant=scope()==='all' ? state.photos : photo ? [photo] : [];
  const scanned=relevant.filter(p=>p.scanned);
  const outdated=scanned.some(p=>p.confidence!==confidence());
  if(mode==='image' && scanned.length) {
    $('chat-note').textContent=scope()==='all'
      ? `Dùng kết quả ${scanned.length}/${state.photos.length} ảnh · Phân tích riêng từng ảnh.`
      : `Ảnh ${state.photos.indexOf(photo)+1} · ${photo.detections.length} vùng · ${photo.types.map(t=>`${t.name}: ${t.count}`).join(' · ') || 'Chưa phát hiện vùng'}`;
    if(outdated) $('chat-note').textContent+=' · Ngưỡng đã đổi, cần quét lại.';
  }
  if(!state.chat?.configured) $('chat-note').textContent='Chatbot chưa được cấu hình. Admin cần thêm API key trong Cài đặt chatbot.';
  $('send').disabled=busy || !state.chat?.configured || (mode==='image' && (!scanned.length || outdated));
  $('analyze-image').classList.toggle('hidden',mode!=='image');
  $('analyze-image').disabled=$('send').disabled;
  $('analyze-image').textContent=scope()==='all' ? '✦ Phân tích tất cả ảnh' : '✦ Phân tích kết quả ảnh';
  saveView();
  renderMessages();
}
function renderMessages() {
  const messages=state.chats[mode], key=JSON.stringify([mode,messages,localBusy,state.job.busy,state.job.error,localError,selected,scope()]); if(key===messagesKey) return;
  const previous=messagesKey ? JSON.parse(messagesKey) : null;
  const current=JSON.parse(key);
  const sameView=previous && previous[0]===mode && JSON.stringify(previous.slice(-2))===JSON.stringify(current.slice(-2));
  const newReply=sameView && messages.at(-1)?.role==='assistant' && JSON.stringify(previous[1])!==JSON.stringify(messages);
  messagesKey=key;
  $('messages').replaceChildren();
  if(!messages.length) { const welcome=text('div','', 'welcome'); welcome.append(text('div','✦','welcome-icon'),text('h3',mode==='general'?'Tôi có thể hỗ trợ gì cho bạn?':'Trao đổi từ kết quả nhận diện'),text('p',mode==='general'?'Hỏi về mụn, thói quen chăm sóc da hoặc tài liệu tham khảo.':'Quét ảnh rồi chọn một ảnh hoặc tất cả ảnh để bắt đầu.'));
    ['Tôi nên chăm sóc da mụn như thế nào?','Khi nào cần gặp bác sĩ da liễu?'].forEach(question=>{ const button=text('button',question,'suggestion'); button.onclick=()=>{ $('question').value=question; $('question').focus(); }; welcome.append(button); }); $('messages').append(welcome); }
  messages.forEach((message,index)=>{ const bubble=text('div',message.text,`bubble ${message.role}`);
    if(newReply && index===messages.length-1) bubble.classList.add('message-enter');
    if(message.sources?.length) { const sources=text('div','Tài liệu đã tham khảo','sources'); message.sources.forEach(source=>{ const button=text('button',`[${source.citation}] ${source.file} · Trang ${source.page}`); button.onclick=()=>showSource(source); sources.append(button); }); bubble.append(sources); } $('messages').append(bubble); });
  if(!state.job.busy && (localError || state.job.error)) $('messages').append(text('div',localError || state.job.error,'bubble error'));
  if(state.job.busy || localBusy) {
    if(pendingQuestion?.mode===mode) $('messages').append(text('div',pendingQuestion.text,'bubble user'));
    const pending=text('div',state.job.status,'bubble pending');
    const dots=text('span','','typing-dots');dots.setAttribute('aria-hidden','true');
    for(let i=0;i<3;i++) dots.append(document.createElement('span'));
    pending.append(dots);$('messages').append(pending);
  } else {
    if(state.job.error && pendingQuestion?.mode===mode && !$('question').value) $('question').value=pendingQuestion.text;
    pendingQuestion=null;
  }
  $('messages').scrollTop=messages.length || state.job.busy || localBusy ? $('messages').scrollHeight : 0;
}
async function refresh() { if(polling || localBusy) return; polling=true; try { state=await api('/api/state'); render(); } catch(exc) { error(exc); } finally { polling=false; } }
async function post(path,data) { try { state=await api(path,data); localError=''; render(); return true; } catch(exc) { error(exc); return false; } }
async function resetImageChat() { if(state?.chats.image.length) await post('/api/reset-chat',{mode:'image'}); }
async function selectPhoto(id) { if(state.job.busy || localBusy || id===selected) return; selected=id; resetZoom(); if(scope()==='one') await resetImageChat(); render(); }
async function fileData(file) {
  let bitmap;try { bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}); } catch {throw new Error('Không đọc được ảnh. Chọn tệp ảnh hợp lệ.');}
  try {
    const ratio=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    let data;for(const quality of [.92,.8,.65,.5]) {data=canvas.toDataURL('image/jpeg',quality).split(',')[1];if(data.length<=1200000)return data;}
    throw new Error('Ảnh vẫn quá lớn sau khi nén. Hãy thu nhỏ ảnh rồi thêm lại.');
  } finally {bitmap.close();}
}
async function addFiles(files) { localBusy=true; render(); try { for(const file of files) { if(file.size>23*1024*1024) throw new Error('Mỗi tệp tối đa 23 MB. Hãy thu nhỏ tệp.'); state=await api('/api/photo',{name:file.name,data:await fileData(file)}); selected=state.photos.at(-1).id; } localError=''; } catch(exc) { error(exc); } finally { localBusy=false; render(); } }
for(const id of ['add-images','empty-add']) $(id).onclick=()=>$('image-files').click();
$('image-files').onchange=async event=>{ await addFiles([...event.target.files]); event.target.value=''; };
$('confidence').oninput=()=>{ $('confidence-value').textContent=$('confidence').value+'%'; render(); };
$('confidence').onchange=resetImageChat;
$('model').onchange=()=>post('/api/invalidate',{});
$('scan').onclick=async()=>{ view='result'; followScan=true; const ok=await post('/api/scan',{model:$('model').value,provider:provider(),remote_model:$('remote-model').value,confidence:confidence()}); if(!ok) followScan=false; };
$('remove-image').onclick=()=>post('/api/remove-photo',{id:selected});
$('original-tab').onclick=()=>{ view='original'; render(); }; $('result-tab').onclick=()=>{ view='result'; render(); };
$('fit').onclick=resetZoom;
$('viewer').addEventListener('wheel',event=>{ if(!activePhoto()) return; event.preventDefault(); zoom=Math.min(6,Math.max(1,zoom*(event.deltaY<0?1.15:1/1.15))); if(zoom===1) panX=panY=0; transform(); },{passive:false});
$('viewer').addEventListener('pointerdown',event=>{ if(!activePhoto()) return; drag={x:event.clientX-panX,y:event.clientY-panY}; $('viewer').setPointerCapture(event.pointerId); });
$('viewer').addEventListener('pointermove',event=>{ if(!drag) return; panX=event.clientX-drag.x; panY=event.clientY-drag.y; transform(); });
for(const event of ['pointerup','pointercancel']) $('viewer').addEventListener(event,()=>drag=null);
$('viewer').ondblclick=resetZoom;
$('general-tab').onclick=()=>{ mode='general'; render(); }; $('image-chat-tab').onclick=()=>{ mode='image'; render(); };
document.querySelectorAll('input[name="scope"]').forEach(input=>input.onchange=async()=>{ await resetImageChat(); render(); });
$('new-chat').onclick=()=>post('/api/reset-chat',{mode});
$('chat-form').onsubmit=async event=>{ event.preventDefault(); if($('send').disabled) return; const message=$('question').value.trim(); if(!message) return; pendingQuestion={mode,text:message}; $('question').value=''; const ok=await post('/api/chat',{message,mode,scope:scope(),image_id:selected,confidence:confidence()}); if(!ok) { if(!$('question').value) $('question').value=message; pendingQuestion=null; } };
$('analyze-image').onclick=()=>{ if($('analyze-image').disabled) return; $('question').value=scope()==='all' ? 'Phân tích kết quả từng ảnh khuôn mặt đã quét và tư vấn theo các loại mụn được phát hiện.' : 'Phân tích kết quả ảnh đang xem và tư vấn theo các loại mụn được phát hiện.'; $('chat-form').requestSubmit(); };
$('question').addEventListener('keydown',event=>{ if(event.key==='Enter'&&!event.shiftKey){ event.preventDefault(); $('chat-form').requestSubmit(); } });
$('upload-model').onclick=()=>{ if(!state.admin?.logged_in || !adminToken) { error(new Error('Đăng nhập admin trước khi thêm mô hình.')); return; } $('model-file').click(); };
$('model-file').onchange=async event=>{ const file=event.target.files[0]; if(!file) return; localBusy=true; render(); try { if(file.size>23*1024*1024) throw new Error('Bản web thử hỗ trợ mô hình tối đa 23 MB.'); state=await api('/api/upload-model',{name:file.name,data:await fileData(file)}); $('model').dataset.choices=''; render(); $('model').value=state.models.find(name=>name===file.name)||state.models.at(-1); } catch(exc) { error(exc); } finally { localBusy=false; render(); event.target.value=''; } };
$('delete-model').onclick=()=>{ const name=$('model').value; if(confirm(`Xóa ${name} khỏi thư viện mô hình? Bản Qt dùng chung thư viện này.`)) post('/api/delete-model',{name}); };
async function stopCamera() { if(stream) stream.getTracks().forEach(track=>track.stop()); stream=null; $('camera-video').srcObject=null; $('capture').disabled=true; }
$('camera-button').onclick=async()=>{ $('camera-dialog').showModal(); $('camera-status').textContent='Đang mở camera…'; try { const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'},audio:false}); if(!$('camera-dialog').open){ media.getTracks().forEach(track=>track.stop()); return; } stream=media; $('camera-video').srcObject=stream; await $('camera-video').play(); $('capture').disabled=false; $('camera-status').textContent='Đưa khuôn mặt vào khung, chọn nơi đủ sáng rồi chụp.'; } catch(exc) { $('camera-status').textContent='Không mở được camera. Hãy cho phép quyền camera hoặc đóng ứng dụng đang dùng webcam. '+exc.message; } };
$('close-camera').onclick=()=>$('camera-dialog').close(); $('camera-dialog').addEventListener('close',stopCamera);
$('camera-dialog').addEventListener('cancel',stopCamera); window.addEventListener('beforeunload',stopCamera);
$('capture').onclick=async()=>{ const video=$('camera-video'); if(!video.videoWidth) return; const canvas=document.createElement('canvas'); canvas.width=video.videoWidth; canvas.height=video.videoHeight; canvas.getContext('2d').drawImage(video,0,0); const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.94));const data=await fileData(blob); $('camera-dialog').close(); const ok=await post('/api/photo',{name:`Camera ${new Date().toLocaleTimeString('vi-VN')}.jpg`,data}); if(ok){ selected=state.photos.at(-1).id; render(); } };
$('documents-button').onclick=async()=>{ $('documents-dialog').showModal(); try { const result=await api('/api/documents'); $('document-list').replaceChildren(); result.documents.forEach(doc=>{ const link=document.createElement('a'); link.className='document'; link.href='/document?file='+encodeURIComponent(doc.file); link.target='_blank'; link.rel='noopener'; link.append(text('strong',doc.title||doc.file),text('span',`${doc.language==='en'?'Tiếng Anh':'Tiếng Việt'}${doc.year?' · '+doc.year:''} · ${doc.pages||'?'} trang · Mở PDF ↗`)); $('document-list').append(link); }); } catch(exc) { $('document-list').textContent=exc.message; } };
$('close-documents').onclick=()=>$('documents-dialog').close();
function showSource(source){ $('source-label').textContent=`${source.file} · Trang PDF ${source.page}`; $('source-text').textContent=source.text; $('source-pdf').href='/document?file='+encodeURIComponent(source.file)+'#page='+source.page; $('source-dialog').showModal(); }
$('close-source').onclick=()=>$('source-dialog').close();
$('recognition-mode').onchange=()=>post('/api/invalidate',{});
$('remote-settings').onclick=()=>{ $('remote-name').value=''; $('remote-endpoint-input').value=''; $('remote-feedback').textContent='Mỗi mô hình cần tên, endpoint và API key riêng.'; $('remote-dialog').showModal(); };
$('close-remote').onclick=()=>$('remote-dialog').close();
$('delete-remote-key').onclick=async()=>{
  if(!adminToken || !state.admin?.logged_in) { error(new Error('Chỉ admin được xóa kết nối API.')); return; }
  if(confirm('Xóa mô hình đang chọn khỏi danh sách dùng chung? Các mô hình khác vẫn được giữ.')) {
    if(await post('/api/delete-remote-model',{id:$('remote-model').value})) $('remote-dialog').close();
  }
};
$('remote-dialog').addEventListener('close',()=>{$('remote-key').value='';});
$('remote-form').onsubmit=async event=>{ event.preventDefault(); const button=event.submitter; button.disabled=true; try { state=await api('/api/add-remote-model',{name:$('remote-name').value,endpoint:$('remote-endpoint-input').value,key:$('remote-key').value}); $('remote-key').value=''; localError=''; $('remote-dialog').close(); render(); } catch(exc) { $('remote-feedback').textContent=exc.message; } finally { button.disabled=false; } };
refresh();let lastRefresh=Date.now();
setInterval(()=>{if(document.visibilityState==='visible' && Date.now()-lastRefresh>60000){lastRefresh=Date.now();refresh();}},5000);
window.addEventListener('focus',()=>{if(Date.now()-lastRefresh>5000){lastRefresh=Date.now();refresh();}});
$('chat-settings').onclick=()=>{ $('chat-key').value=''; $('chat-feedback').textContent=''; $('chat-dialog').showModal(); };
$('close-chat-settings').onclick=()=>$('chat-dialog').close();
$('chat-dialog').addEventListener('close',()=>{$('chat-key').value='';});
$('chat-settings-form').onsubmit=async event=>{
  event.preventDefault(); const submit=event.submitter; submit.disabled=true;
  try { state=await api('/api/chat-settings',{key:$('chat-key').value,model:state.chat.model}); localError=''; $('chat-dialog').close(); render(); }
  catch(exc) { $('chat-feedback').textContent=exc.message; }
  finally { submit.disabled=false; }
};
$('delete-chat-key').onclick=async()=>{ if(confirm('Xóa API key chatbot? Người dùng sẽ chưa chat được cho đến khi admin thêm key.')) { if(await post('/api/delete-chat-key',{})) $('chat-dialog').close(); } };

$('remote-model').onchange=()=>post('/api/invalidate',{});

// Convert the annotated SVG into a true PNG for the existing download button.
$('save-result').onclick=async event=>{
  event.preventDefault();const photo=activePhoto();if(!photo?.scanned)return;
  let objectUrl;
  try {
    const result=await fetch(photoUrl(photo,'result'));if(!result.ok)throw new Error('Không tải được ảnh kết quả.');
    objectUrl=URL.createObjectURL(await result.blob());const image=new Image();image.src=objectUrl;await image.decode();
    const canvas=document.createElement('canvas');canvas.width=photo.width;canvas.height=photo.height;canvas.getContext('2d').drawImage(image,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));const output=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=output;link.download='anh_nhan_dien.png';link.click();setTimeout(()=>URL.revokeObjectURL(output),5000);
  } catch(exc) {error(exc);} finally {if(objectUrl)URL.revokeObjectURL(objectUrl);}
};

// Fade the newly decoded photo without changing zoom/pan transforms.
$('large-image').addEventListener('load',()=>{
  if(!matchMedia('(prefers-reduced-motion: reduce)').matches) $('large-image').animate([{opacity:.35},{opacity:1}],{duration:220,easing:'ease-out'});
});
