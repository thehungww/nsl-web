'use strict';
// Optional photo contributions. The server enforces consent independently of UI.
(() => {
  let prompted=false,working=false;
  const receiptKey='acne-photo-withdrawal-v1';
  function savedCodes() {try{return JSON.parse(localStorage.getItem(receiptKey)) || [];}catch{return [];}}
  function saveCode(code) {try {localStorage.setItem(receiptKey,JSON.stringify([...savedCodes().filter(x=>x!==code),code].slice(-20)));}catch{}}
  function removeCode(code) {try {localStorage.setItem(receiptKey,JSON.stringify(savedCodes().filter(x=>x!==code)));}catch{}}
  function populate() {
    const c=state?.collection;if(!c)return;
    $('collection-controller').textContent=c.controller || 'Chưa có thông tin đơn vị quản lý';
    $('collection-contact').textContent=c.contact || 'Chưa cấu hình liên hệ';
    $('collection-availability').textContent=!c.available?'Thu ảnh đóng góp hiện chưa bật. Bạn vẫn dùng web bình thường.':c.accepted?'Bạn đã đồng ý. Chỉ ảnh thêm sau lúc đồng ý mới được gửi.':c.revoked?'Đã dừng đóng góp. Bạn có thể gửi lại yêu cầu xóa bằng mã nếu lần trước chưa hoàn tất.':'Hoàn toàn tự nguyện. Từ chối không ảnh hưởng chức năng nhận diện và chatbot.';
    $('collection-accept').disabled=working || !c.available || c.accepted || !$('collection-adult').checked || !$('collection-own').checked || !$('collection-agree').checked;
    $('collection-decline').disabled=working;
    $('collection-withdraw').disabled=working;
    $('collection-code').value=$('collection-code').value || savedCodes().at(-1) || '';
  }
  function show() {
    $('collection-adult').checked=false;$('collection-own').checked=false;$('collection-agree').checked=false;
    $('collection-feedback').textContent='';populate();
    if(!$('collection-dialog').open)$('collection-dialog').showModal();
  }
  function update() {
    const c=state?.collection,admin=!!state?.admin?.logged_in && !!adminToken;
    $('collection-button').classList.toggle('hidden',!c);
    $('collection-settings').classList.toggle('hidden',!c || !admin);
    $('collection-button').disabled=!!state?.job?.busy || localBusy;
    $('collection-settings').disabled=!!state?.job?.busy || localBusy;
    const sent=state?.photos?.filter(p=>p.collection_status==='sent').length || 0;
    const failed=state?.photos?.filter(p=>p.collection_status==='failed').length || 0;
    $('collection-photo-status').textContent=c?.accepted?`Đóng góp: ${sent} ảnh đã lưu vào Drive.${failed?' '+failed+' ảnh chưa xác nhận lưu; có thể thử gửi lại.':''}`:'';
    $('collection-retry').classList.toggle('hidden',!c?.accepted || !failed);
    $('collection-retry').disabled=working || localBusy || !!state?.job?.busy;
    if($('collection-dialog').open)populate();
    if(c?.available && !c.decision && !prompted && !localBusy && !state.job.busy) {prompted=true;show();}
  }
  async function perform(path,body,feedback) {
    working=true;populate();
    try {
      const result=await api(path,body);state=result;localError='';
      if(result.collection_receipt) {
        saveCode(result.collection_receipt);$('collection-code').value=result.collection_receipt;
        $('collection-receipt').textContent=result.collection_receipt;$('collection-receipt-panel').classList.remove('hidden');
        delete state.collection_receipt;
      }
      render();return result;
    } catch(exc) {
      if(path==='/api/collection-withdraw') {try {state=await api('/api/state');render();}catch{}}
      $(feedback).textContent=exc.message;return null;
    }
    finally {working=false;populate();}
  }
  $('collection-button').onclick=show;
  $('close-collection').onclick=()=>$('collection-dialog').close();
  for(const id of ['collection-adult','collection-own','collection-agree'])$(id).onchange=populate;
  $('collection-accept').onclick=async()=>{
    const result=await perform('/api/collection-consent',{accepted:true,adult:$('collection-adult').checked,self_image:$('collection-own').checked,policy_version:state.collection.policy_version},'collection-feedback');
    if(result)$('collection-feedback').textContent='Đã đồng ý. Hãy lưu mã xóa ảnh bên dưới, rồi đóng bảng để tiếp tục. Ảnh đã thêm trước đó không được gửi.';
  };
  $('collection-decline').onclick=async()=>{
    if(await perform('/api/collection-consent',{accepted:false},'collection-feedback'))$('collection-dialog').close();
  };
  $('collection-withdraw').onclick=async()=>{
    const code=$('collection-code').value.trim();
    if(!code && !state.collection?.accepted && !state.collection?.revoked){$('collection-feedback').textContent='Nhập mã xóa ảnh đã nhận khi đồng ý.';return;}
    if(await perform('/api/collection-withdraw',{code},'collection-feedback')) {
      removeCode(code);$('collection-receipt-panel').classList.add('hidden');
      $('collection-feedback').textContent='Đã dừng đóng góp và xác nhận xóa ảnh trên Drive. Lựa chọn này không xóa ảnh đang dùng trong phiên nhận diện.';
    }
  };
  $('collection-download-code').onclick=()=>{
    const code=$('collection-receipt').textContent;if(!code)return;
    const blob=new Blob(['Mã xóa ảnh đóng góp AcneCheck\n'+code+'\nMở trang web, chọn Quyền riêng tư & đóng góp ảnh, nhập mã để yêu cầu xóa. Giữ mã này riêng tư.\n'],{type:'text/plain;charset=utf-8'});
    const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download='ma-xoa-anh.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  $('collection-retry').onclick=async()=>{
    for(const p of state.photos.filter(p=>p.collection_status==='failed'))
      if(!await perform('/api/collection-retry',{id:p.id},'collection-photo-status'))break;
  };
  $('collection-settings').onclick=()=>{
    $('collection-enabled').checked=!!state.collection.available;
    $('collection-url').value=state.collection.endpoint || '';
    $('collection-manager').value=state.collection.controller || '';
    $('collection-manager-contact').value=state.collection.contact || '';
    $('collection-secret').value='';$('collection-settings-feedback').textContent='';
    $('collection-settings-dialog').showModal();
  };
  $('close-collection-settings').onclick=()=>$('collection-settings-dialog').close();
  $('collection-settings-dialog').addEventListener('close',()=>{$('collection-secret').value='';});
  $('collection-settings-form').onsubmit=async event=>{
    event.preventDefault();event.submitter.disabled=true;
    try {
      const result=await perform('/api/collection-settings',{enabled:$('collection-enabled').checked,url:$('collection-url').value.trim(),secret:$('collection-secret').value.trim(),controller:$('collection-manager').value,contact:$('collection-manager-contact').value},'collection-settings-feedback');
      if(result)$('collection-settings-dialog').close();
    }finally{event.submitter.disabled=false;}
  };
  window.addEventListener('acne-state',update);update();
})();
