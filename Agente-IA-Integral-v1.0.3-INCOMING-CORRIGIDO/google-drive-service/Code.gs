// Executa na conta proprietária. O token Google nunca sai deste serviço.
const ROOT_GUARATUBA='1ZgjCZPG5Xl1ZyZofu1EmSDCzWqneVsnE';
const SETUP_SECRET_GUARATUBA=''; // Injetado somente na cópia privada implantada, nunca no Git.
const MAX_BYTES_GUARATUBA=20*1024*1024;
const FILE_FIELDS_GUARATUBA='id,name,mimeType,parents,trashed,size,md5Checksum,appProperties,capabilities(canAddChildren)';
function doGet(){return outputGuaratuba_({ok:false,error:'auth_required'});}
function outputGuaratuba_(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
function equalGuaratuba_(a,b){if(typeof a!=='string'||typeof b!=='string'||!/^[a-f0-9]{64}$/.test(a)||!/^[a-f0-9]{64}$/.test(b))return false;let diff=0;for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function idGuaratuba_(id){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{10,200}$/.test(id))throw new Error('invalid_id');return id;}
function metaGuaratuba_(id){return Drive.Files.get(idGuaratuba_(id),{supportsAllDrives:true,fields:FILE_FIELDS_GUARATUBA});}
function insideGuaratuba_(id){
 let current=idGuaratuba_(id),selected;const visited={};
 for(let i=0;i<30;i++){
  if(visited[current])break;visited[current]=true;
  const file=metaGuaratuba_(current);if(file.trashed)throw new Error('outside_root');if(!selected)selected=file;
  if(current===ROOT_GUARATUBA)return selected;
  if(!file.parents||file.parents.length!==1)break;current=file.parents[0];
 }
 throw new Error('outside_root');
}
function folderGuaratuba_(id){const f=insideGuaratuba_(id);if(f.mimeType!=='application/vnd.google-apps.folder')throw new Error('invalid_folder');return f;}
function hexGuaratuba_(digest){return digest.map(x=>((x+256)%256).toString(16).padStart(2,'0')).join('');}
function mimeGuaratuba_(bytes){
 const b=bytes.slice(0,12).map(x=>(x+256)%256);const ascii=(start,end)=>String.fromCharCode.apply(null,b.slice(start,end));
 if(ascii(0,5)==='%PDF-')return 'application/pdf';
 if(b.slice(0,8).join(',')==='137,80,78,71,13,10,26,10')return 'image/png';
 if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
 if(ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP')return 'image/webp';
 throw new Error('unsupported_file');
}
function listGuaratuba_(folder,pageToken){
 folderGuaratuba_(folder);if(pageToken&&String(pageToken).length>2048)throw new Error('invalid_page');
 return Drive.Files.list({q:"'"+folder+"' in parents and trashed = false",pageSize:100,fields:'nextPageToken,files('+FILE_FIELDS_GUARATUBA+')',supportsAllDrives:true,includeItemsFromAllDrives:true,...(pageToken?{pageToken}: {})});
}
function downloadGuaratuba_(id){
 const file=insideGuaratuba_(id);if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(file.mimeType)||!file.size||Number(file.size)>MAX_BYTES_GUARATUBA)throw new Error('unsupported_file');
 const response=UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?alt=media&supportsAllDrives=true',{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true,followRedirects:false});
 if(response.getResponseCode()!==200)throw new Error('download_failed');
 const bytes=response.getBlob().getBytes();if(!bytes.length||bytes.length>MAX_BYTES_GUARATUBA)throw new Error('unsupported_file');
 mimeGuaratuba_(bytes);return {base64:Utilities.base64Encode(bytes),mime:file.mimeType};
}
function uploadGuaratuba_(p){
 const folder=folderGuaratuba_(p.folder);if(p.folder===ROOT_GUARATUBA||folder.capabilities?.canAddChildren!==true)throw new Error('invalid_folder');
 if(!/^[0-9a-f-]{36}$/.test(String(p.clientId))||typeof p.origin!=='string'||!/^[A-Za-z0-9:_-]{1,100}$/.test(p.origin)||typeof p.base64!=='string'||p.base64.length>28*1024*1024||!/^[a-f0-9]{64}$/.test(String(p.hash)))throw new Error('invalid_upload');
 const bytes=Utilities.base64Decode(p.base64);if(!bytes.length||bytes.length>MAX_BYTES_GUARATUBA||mimeGuaratuba_(bytes)!==p.mime||hexGuaratuba_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes))!==p.hash)throw new Error('invalid_upload');
 const lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw new Error('busy');
 try{
  folderGuaratuba_(p.folder);
  const q="'"+p.folder+"' in parents and trashed = false and appProperties has { key='integral_client_id' and value='"+p.clientId+"' } and (appProperties has { key='integral_origin' and value='"+p.origin+"' } or appProperties has { key='integral_sha256' and value='"+p.hash+"' })";
  const prior=(Drive.Files.list({q,pageSize:100,fields:'files(id,name,parents,md5Checksum)',supportsAllDrives:true,includeItemsFromAllDrives:true}).files||[])[0];
  const md5=hexGuaratuba_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5,bytes));
  if(prior){if(prior.md5Checksum!==md5)throw new Error('conflicting_receipt');return prior;}
  const name=String(p.name||'Documento recebido').replace(/[\r\n\u0000]/g,'').slice(0,180);
  const file=Drive.Files.create({name,mimeType:p.mime,parents:[p.folder],appProperties:{integral_client_id:p.clientId,integral_origin:p.origin,integral_sha256:p.hash}},Utilities.newBlob(bytes,p.mime,name),{supportsAllDrives:true,fields:'id,name,parents,md5Checksum'});
  const checked=insideGuaratuba_(file.id);if(!checked.parents?.includes(p.folder)||checked.md5Checksum!==md5)throw new Error('unconfirmed_receipt');return checked;
 }finally{lock.releaseLock();}
}
function doPost(e){
 try{
  if(!e?.postData?.contents||e.postData.contents.length>30*1024*1024)return outputGuaratuba_({ok:false,error:'auth_required'});
  const p=JSON.parse(e.postData.contents),expected=PropertiesService.getScriptProperties().getProperty('INTEGRAL_DRIVE_SECRET')||SETUP_SECRET_GUARATUBA;
  if(!equalGuaratuba_(p.key,expected))return outputGuaratuba_({ok:false,error:'auth_required'});
  let data;
  if(p.op==='meta')data=insideGuaratuba_(p.id);
  else if(p.op==='list')data=listGuaratuba_(p.folder,p.pageToken);
  else if(p.op==='download')data=downloadGuaratuba_(p.id);
  else if(p.op==='upload')data=uploadGuaratuba_(p);
  else throw new Error('invalid_operation');
  return outputGuaratuba_({ok:true,data});
 }catch{return outputGuaratuba_({ok:false,error:'drive_operation_failed'});}
}
