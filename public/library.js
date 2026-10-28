'use strict';
// Private library. Every image request needs both the session and admin token.
(() => {
  let meta=null,working=false,generation=0,controller=null;
  const blobs=new Map(),selectedIds=new Set();
  const allowed=()=>!!state?.admin?.logged_in && !!adminToken;
  const el=(tag,value,cls)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;if(cls)n.className=cls;return n;};
  const date=n=>new Date(n*1000).toLocaleString('vi-VN');
  const mb=n=>(n/1024/1024).toLocaleString('vi-VN',{maximumFractionDigits:1});
  function reset() {
    generation++;controller?.abort();controller=new AbortController();
    if($('collection-preview-dialog').open)$('collection-preview-dialog').close();
    $('collection-preview').removeAttribute('src');
    for(const item of blobs.values())URL.revokeObjectURL(item.url);
    blobs.clear();selectedIds.clear();meta=null;$('collection-library-grid').replaceChildren();
    $('collection-select-all').checked=false;
  }
  function controls() {
    const busy=working || localBusy || !!state?.job?.busy;
    $('collection-library-button').classList.toggle('hidden',!allowed());
    $('collection-library-button').disabled=busy;
    $('collection-delete-selected').disabled=busy || !selectedIds.size;
    $('collection-zip').disabled=busy || !meta?.images.length;
    $('collection-refresh').disabled=busy;
    $('collection-prev').disabled=busy || !meta || meta.page===0;
    $('collection-next').disabled=busy || !meta || meta.page+1>=meta.pages;
    $('collection-select-all').disabled=busy || !meta?.images.length;
    if(!allowed() && (meta || $('collection-library-dialog').open)) {
      if($('collection-library-dialog').open)$('collection-library-dialog').close();else reset();
    }
  }
  async function imageBlob(id,signal=controller?.signal) {
    if(blobs.has(id))return blobs.get(id);
    if(!allowed())throw new Error('Cần đăng nhập admin.');
    const result=await fetch('/api/collection-image?id='+encodeURIComponent(id),{headers:{'X-Admin-Token':adminToken},cache:'no-store',signal});
    if(!result.ok){const error=await result.json();throw new Error(error.error || 'Không tải được ảnh.');}
    if(!result.headers.get('Content-Type')?.startsWith('image/jpeg'))throw new Error('Ảnh trả về không hợp lệ.');
    const blob=await result.blob();if(signal?.aborted || !allowed())throw new Error('Đã hủy tải ảnh.');
    const item={blob,url:URL.createObjectURL(blob)};blobs.set(id,item);return item;
  }
  function download(blob,name) {
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function remove(ids) {
    if(!ids.length || !confirm(`Xóa ${ids.length} ảnh khỏi kho đóng góp? Ảnh đã tải về cần được bạn xóa riêng.`))return;
    working=true;controls();
    try {
      const result=await api('/api/collection-delete',{ids});state=result;delete state.collection_deletion;render();
      await load(meta?.page || 0);
    }catch(error){$('collection-library-feedback').textContent=error.message;}
    finally{working=false;controls();}
  }
  function card(photo) {
    const node=el('article',undefined,'library-card'),preview=el('button',undefined,'library-photo');
    preview.type='button';preview.title='Xem ảnh lớn';preview.setAttribute('aria-label','Xem ảnh '+photo.id);
    const img=el('img');img.alt='Ảnh đóng góp '+photo.id;preview.append(img);
    preview.onclick=async()=>{try{const item=await imageBlob(photo.id);$('collection-preview').src=item.url;$('collection-preview-title').textContent='Ảnh '+photo.id.slice(0,8);$('collection-preview-dialog').showModal();}catch(error){$('collection-library-feedback').textContent=error.message;}};
    const choice=el('label',undefined,'library-choice'),checkbox=el('input');checkbox.type='checkbox';checkbox.dataset.id=photo.id;checkbox.setAttribute('aria-label','Chọn ảnh '+photo.id);
    choice.append(checkbox,el('span',photo.id.slice(0,8)));checkbox.onchange=()=>{checkbox.checked?selectedIds.add(photo.id):selectedIds.delete(photo.id);$('collection-select-all').checked=meta.images.every(p=>selectedIds.has(p.id));controls();};
    const details=el('p',`${photo.width} × ${photo.height} · ${date(photo.created)}`, 'library-detail');
    const expiry=el('p','Hết hạn: '+date(photo.expires),'library-detail');
    const actions=el('div',undefined,'library-card-actions'),save=el('button','↓ Tải ảnh','library-download'),erase=el('button','Xóa','danger library-delete');
    save.onclick=async()=>{try{save.disabled=true;const item=await imageBlob(photo.id);if(allowed())download(item.blob,'anh-'+photo.id+'.jpg');}catch(error){$('collection-library-feedback').textContent=error.message;}finally{save.disabled=false;}};
    erase.onclick=()=>remove([photo.id]);actions.append(save,erase);node.append(preview,choice,details,expiry,actions);return {node,img};
  }
  async function load(page=0) {
    reset();const current=generation;working=true;controls();$('collection-library-feedback').textContent='Đang tải kho ảnh…';
    try {
      const result=await api('/api/collection-list',{page});if(current!==generation || !allowed())return;
      meta=result.collection_library;delete result.collection_library;state=result;render();
      $('collection-library-stats').textContent=`${meta.total} ảnh · ${mb(meta.used_bytes)} / ${mb(meta.limit_bytes)} MB dữ liệu ảnh · Tối đa ${meta.max_images} ảnh`;
      $('collection-page-label').textContent=`Trang ${meta.page+1} / ${meta.pages}`;
      const entries=meta.images.map(photo=>({...card(photo),photo}));
      $('collection-library-grid').replaceChildren(...entries.map(x=>x.node));
      if(!entries.length)$('collection-library-grid').append(el('p','Chưa có ảnh đóng góp. Ảnh chỉ xuất hiện sau khi người dùng đồng ý và thêm ảnh mới.','library-empty'));
      $('collection-library-feedback').textContent='';
      let next=0;
      await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{
        while(next<entries.length && current===generation) {
          const entry=entries[next++];
          try {const item=await imageBlob(entry.photo.id);if(current===generation)entry.img.src=item.url;}
          catch(error){if(current===generation)$('collection-library-feedback').textContent=error.message;}
        }
      }));
    }catch(error){if(current===generation)$('collection-library-feedback').textContent=error.message;}
    finally{if(current===generation){working=false;controls();}}
  }
  const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc(bytes){let n=0xffffffff;for(const b of bytes)n=crcTable[(n^b)&255]^(n>>>8);return (n^0xffffffff)>>>0;}
  // Store JPEGs directly in ZIP; no third-party script or public image URL.
  async function zip(entries) {
    const files=[],central=[];let offset=0,centralSize=0;
    for(const entry of entries) {
      const name=new TextEncoder().encode(entry.name),bytes=new Uint8Array(await entry.blob.arrayBuffer()),sum=crc(bytes),local=new Uint8Array(30),l=new DataView(local.buffer);
      l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(12,33,true);l.setUint32(14,sum,true);l.setUint32(18,bytes.length,true);l.setUint32(22,bytes.length,true);l.setUint16(26,name.length,true);
      const header=new Uint8Array(46),c=new DataView(header.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(14,33,true);c.setUint32(16,sum,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
      files.push(local,name,entry.blob);central.push(header,name);centralSize+=header.length+name.length;offset+=local.length+name.length+bytes.length;
    }
    const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
    return new Blob([...files,...central,end],{type:'application/zip'});
  }
  $('collection-library-button').onclick=()=>{$('collection-library-dialog').showModal();load();};
  $('close-collection-library').onclick=()=>$('collection-library-dialog').close();
  $('collection-library-dialog').addEventListener('close',()=>{reset();working=false;controls();});
  $('close-collection-preview').onclick=()=>$('collection-preview-dialog').close();
  $('collection-preview-dialog').addEventListener('close',()=>$('collection-preview').removeAttribute('src'));
  $('collection-refresh').onclick=()=>load(meta?.page || 0);
  $('collection-prev').onclick=()=>load(meta.page-1);
  $('collection-next').onclick=()=>load(meta.page+1);
  $('collection-select-all').onchange=()=>{
    for(const checkbox of $('collection-library-grid').querySelectorAll('input[type=checkbox]')){checkbox.checked=$('collection-select-all').checked;checkbox.checked?selectedIds.add(checkbox.dataset.id):selectedIds.delete(checkbox.dataset.id);}controls();
  };
  $('collection-delete-selected').onclick=()=>remove([...selectedIds]);
  $('collection-zip').onclick=async()=>{
    if(!meta?.images.length)return;working=true;controls();const current=generation,photos=[...meta.images];
    $('collection-library-feedback').textContent='Đang tạo tệp ZIP…';
    try {
      const entries=[];for(const photo of photos){const item=await imageBlob(photo.id);entries.push({name:'anh-'+photo.id+'.jpg',blob:item.blob});}
      entries.push({name:'thong-tin-anh.json',blob:new Blob([JSON.stringify({exported_at:new Date().toISOString(),images:photos},null,2)],{type:'application/json'})});
      const archive=await zip(entries);if(current===generation && allowed()){download(archive,'anh-dong-gop-trang-'+(meta.page+1)+'.zip');$('collection-library-feedback').textContent='Đã tạo ZIP gồm ảnh của trang này và thông tin hạn lưu.';}
    }catch(error){if(current===generation)$('collection-library-feedback').textContent=error.message;}
    finally{working=false;controls();}
  };
  window.addEventListener('acne-state',controls);controls();
})();
