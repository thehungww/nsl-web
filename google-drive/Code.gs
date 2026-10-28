/* Paste into a NEW Google Apps Script project. Run setupCollection once.
 * Only a dedicated, private folder created by this project is used.
 * Never copy images from this folder to a training dataset without retaining
 * receipt/expiry identifiers and honoring withdrawals. */
var COLLECTION_PROTOCOL = 'acne-drive-v1';
var COLLECTION_POLICY = '2026-10-28-v2';
var COLLECTION_DAYS = 90;

function setupCollection() {
  var props=PropertiesService.getScriptProperties();
  var id=props.getProperty('COLLECTION_FOLDER_ID');
  if(!id) {
    var folder=DriveApp.createFolder('AcneCheck - Anh dong gop rieng tu');
    folder.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);
    id=folder.getId();props.setProperty('COLLECTION_FOLDER_ID',id);
  }
  if(!props.getProperty('COLLECTION_SECRET')) props.setProperty('COLLECTION_SECRET',Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''));
  if(!ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='cleanupExpiredImages';}))
    ScriptApp.newTrigger('cleanupExpiredImages').timeBased().everyHours(1).create();
  console.log('Folder: https://drive.google.com/drive/folders/'+id);
  console.log('Connection code (paste into admin settings only): '+props.getProperty('COLLECTION_SECRET'));
  console.log('Deploy as Web app: execute as yourself; access Anyone. The private connection code authenticates server requests.');
}
function json_(body) {body.protocol=COLLECTION_PROTOCOL;return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);}
function same_(a,b) {if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;var diff=0;for(var i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function root_(requirePrivate) {
  var id=PropertiesService.getScriptProperties().getProperty('COLLECTION_FOLDER_ID');
  if(!id)throw new Error('setup');
  var folder=DriveApp.getFolderById(id);
  if(folder.isTrashed())throw new Error('folder');
  if(requirePrivate!==false && (folder.getSharingAccess()!==DriveApp.Access.PRIVATE || folder.getEditors().length || folder.getViewers().length))throw new Error('private');
  return folder;
}
function doGet() {return json_({ok:false});}
function doPost(e) {
  var lock=LockService.getScriptLock();
  try {
    if(!e || !e.postData || e.postData.contents.length>1250000)return json_({ok:false});
    var body=JSON.parse(e.postData.contents),secret=PropertiesService.getScriptProperties().getProperty('COLLECTION_SECRET');
    if(!secret || !same_(body.secret,secret))return json_({ok:false});
    lock.waitLock(15000);
    var root=root_(body.action!=='withdraw');
    if(body.action==='ping') {
      var hasCleanup=ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()==='cleanupExpiredImages';});
      return json_({ok:hasCleanup,private:true,retention_days:COLLECTION_DAYS});
    }
    if(!/^[a-f0-9]{64}$/.test(body.receipt_hash || ''))return json_({ok:false});
    var matches=root.getFoldersByName(body.receipt_hash),folder=matches.hasNext()?matches.next():null;
    var time=Math.floor(Date.now()/1000),metadata=folder?JSON.parse(folder.getDescription()):null;
    if(body.action==='withdraw') {
      if(!Number.isInteger(body.expires_at) || body.expires_at>time+COLLECTION_DAYS*86400+300)return json_({ok:false});
      if(!folder) {
        folder=root.createFolder(body.receipt_hash);
        metadata={created:time,expires:body.expires_at,policy:COLLECTION_POLICY};
      }
      metadata.revoked=true;folder.setDescription(JSON.stringify(metadata));
      eraseFiles_(folder);
      return json_({ok:true,erased:true});
    }
    if(body.action!=='upload' || !/^[a-f0-9]{24}$/.test(body.id || ''))return json_({ok:false});
    var c=body.consent;
    if(!c || c.version!==COLLECTION_POLICY || c.self_image!==true || !Number.isInteger(c.accepted_at) || !Number.isInteger(c.expires_at) || c.accepted_at>time+300 || c.expires_at-c.accepted_at!==COLLECTION_DAYS*86400 || c.expires_at<=time)return json_({ok:false});
    if(typeof body.data!=='string' || body.data.length>1200000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data))return json_({ok:false});
    if(metadata && (metadata.revoked || metadata.expires!==c.expires_at || metadata.created!==c.accepted_at))return json_({ok:false});
    if(!folder) {
      folder=root.createFolder(body.receipt_hash);
      metadata={created:c.accepted_at,expires:c.expires_at,policy:c.version,self_image:true,revoked:false};
      folder.setDescription(JSON.stringify(metadata));
    }
    if(folder.getSharingAccess()!==DriveApp.Access.PRIVATE || folder.getEditors().length || folder.getViewers().length)return json_({ok:false});
    var existing=folder.getFilesByName(body.id+'.jpg');
    if(!existing.hasNext()) {
      var bytes=Utilities.base64Decode(body.data);
      if(bytes.length<4 || (bytes[0]&255)!==255 || (bytes[1]&255)!==216 || (bytes[bytes.length-2]&255)!==255 || (bytes[bytes.length-1]&255)!==217)return json_({ok:false});
      var file=folder.createFile(Utilities.newBlob(bytes,'image/jpeg',body.id+'.jpg'));
      file.setDescription(JSON.stringify({id:body.id,receipt_hash:body.receipt_hash,policy:c.version,accepted_at:c.accepted_at,expires_at:c.expires_at,usage:'acne-model-evaluation-and-training'}));
      // No public link, original filename, chat text, IP, or identity is stored.
    }
    return json_({ok:true,id:body.id});
  } catch(error) {
    // Do not expose or log the request, photograph, token, or Google error details.
    return json_({ok:false});
  } finally {if(lock.hasLock())lock.releaseLock();}
}
function eraseFiles_(folder) {
  var files=folder.getFiles();
  while(files.hasNext()) {
    var file=files.next();
    // Permanent Drive deletion, rather than leaving face photographs in Trash.
    var result=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(file.getId()),{
      method:'delete',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true
    });
    if(result.getResponseCode()!==204 && result.getResponseCode()!==404)throw new Error('delete');
  }
}
function cleanupExpiredImages() {
  var lock=LockService.getScriptLock();lock.waitLock(15000);
  try {
    var folders=root_(false).getFolders(),time=Math.floor(Date.now()/1000),started=Date.now();
    while(folders.hasNext() && Date.now()-started<240000) {
      var folder=folders.next();if(!/^[a-f0-9]{64}$/.test(folder.getName()))continue;
      var data=JSON.parse(folder.getDescription());
      if(data.revoked || data.expires<=time) {
        data.revoked=true;folder.setDescription(JSON.stringify(data));eraseFiles_(folder);
        // Keep empty tombstones until after expiry to reject delayed uploads.
        if(data.expires<time-86400)folder.setTrashed(true);
      }
    }
  } finally {lock.releaseLock();}
}
