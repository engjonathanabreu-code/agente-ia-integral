import {createSign,createHash,randomUUID} from 'node:crypto';
import {scriptConfigured,scriptOperation,scriptReadOperation} from './documental-script.js';

export const MAX_DOCUMENT_BYTES=20*1024*1024;
export const driveConfigured=()=>!!(scriptConfigured()||process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON||(process.env.GOOGLE_DRIVE_CLIENT_ID&&process.env.GOOGLE_DRIVE_CLIENT_SECRET&&process.env.GOOGLE_DRIVE_REFRESH_TOKEN));
export async function driveToken(){
 if(scriptConfigured())return 'google-script';
 let body;
 if(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON){
  const key=JSON.parse(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON),now=Math.floor(Date.now()/1000);
  const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:key.client_email,scope:'https://www.googleapis.com/auth/drive',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const sign=createSign('RSA-SHA256');sign.update(unsigned);sign.end();
  body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+sign.sign(key.private_key).toString('base64url')});
 }else{
  if(!driveConfigured())throw new Error('drive_nao_conectado');
  body=new URLSearchParams({grant_type:'refresh_token',client_id:process.env.GOOGLE_DRIVE_CLIENT_ID,client_secret:process.env.GOOGLE_DRIVE_CLIENT_SECRET,refresh_token:process.env.GOOGLE_DRIVE_REFRESH_TOKEN});
 }
 const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw new Error('drive_autorizacao_indisponivel');
 const value=await r.json();if(!value.access_token)throw new Error('drive_autorizacao_indisponivel');return value.access_token;
}
export async function driveRequest(path,token,options={}){
 if(token==='google-script'){
  const request=scriptReadOperation(path,options),data=await scriptOperation(request.op,request.data);
  if(!options.binary)return data;
  if(typeof data.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(data.base64)||data.base64.length>28*1024*1024)throw new Error('drive_documento_invalido');
  const bytes=Buffer.from(data.base64,'base64');if(!bytes.length||bytes.length>MAX_DOCUMENT_BYTES)throw new Error('documento_muito_grande');documentMime(bytes);return bytes;
 }
 const r=await fetch('https://www.googleapis.com/drive/v3/'+path,{...options,headers:{Authorization:'Bearer '+token,...options.headers},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw new Error('drive_operacao_'+r.status);
 return options.binary?limitedBytes(r):r.json();
}
export async function verifyFolder(id,root,token){
 let current=id;const visited=new Set();let selected;
 for(let depth=0;depth<30;depth++){
  if(visited.has(current))throw new Error('drive_pasta_invalida');visited.add(current);
  const f=await driveRequest('files/'+encodeURIComponent(current)+'?supportsAllDrives=true&fields=id,mimeType,parents,trashed,capabilities(canAddChildren)',token);
  if(f.trashed||f.mimeType!=='application/vnd.google-apps.folder')throw new Error('drive_pasta_invalida');
  if(!selected)selected=f;
  if(current===root){if(selected.capabilities?.canAddChildren!==true)throw new Error('drive_sem_permissao_gravar');return selected;}
  if(!Array.isArray(f.parents)||f.parents.length!==1)break;current=f.parents[0];
 }
 throw new Error('drive_pasta_fora_guaratuba');
}
export async function listFolder(folder,token){
 let pageToken='',all=[];
 do{
  const q=new URLSearchParams({q:`'${folder.replace(/'/g,"\\'")}' in parents and trashed = false`,pageSize:'100',fields:'nextPageToken,files(id,name,mimeType,md5Checksum,appProperties,parents)',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
  if(pageToken)q.set('pageToken',pageToken);
  const r=await driveRequest('files?'+q,token);all.push(...(r.files||[]));pageToken=r.nextPageToken||'';
  if(all.length>5000)throw new Error('drive_inventario_excessivo');
 }while(pageToken);
 return all;
}
export async function listClientFiles(folder,token,beforeRead=async()=>{},otherClientFolders=[]){
 const queue=[{id:folder,depth:0}],visited=new Set(),files=[];
 while(queue.length){
  const current=queue.shift();
  if(otherClientFolders.includes(current.id))throw new Error('drive_pasta_de_outro_cliente');
  if(visited.has(current.id)||current.depth>12||visited.size>=100)throw new Error('drive_inventario_incompleto');
  visited.add(current.id);await beforeRead();
  for(const f of await listFolder(current.id,token)){
   if(!f.parents?.includes(current.id))throw new Error('drive_inventario_divergente');
   if(f.mimeType==='application/vnd.google-apps.folder')queue.push({id:f.id,depth:current.depth+1});
   else files.push(f);
   if(files.length+queue.length>5000)throw new Error('drive_inventario_excessivo');
  }
 }
 return files;
}
export function validAttachmentURL(value,hosts){
 let u;try{u=new URL(value);}catch{throw new Error('anexo_url_invalida');}
 if(u.protocol!=='https:'||u.username||u.password||!hosts.includes(u.hostname)||u.port&&u.port!=='443')throw new Error('anexo_origem_recusada');
 return u;
}
export async function limitedBytes(response){
 if(Number(response.headers.get('content-length')||0)>MAX_DOCUMENT_BYTES)throw new Error('documento_muito_grande');
 const reader=response.body.getReader();let size=0,chunks=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_DOCUMENT_BYTES){await reader.cancel();throw new Error('documento_muito_grande');}chunks.push(Buffer.from(value));}
 if(!size)throw new Error('documento_vazio');return Buffer.concat(chunks);
}
export function documentMime(bytes){
 if(bytes.subarray(0,5).toString()==='%PDF-')return 'application/pdf';
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
 throw new Error('documento_formato_nao_suportado');
}
export async function fetchAttachment(url){
 const hosts=[new URL(process.env.CHATWOOT_BASE_URL).hostname,...String(process.env.DOCUMENTAL_ATTACHMENT_HOSTS||'').split(',').map(s=>s.trim()).filter(Boolean)];
 for(let i=0;i<5;i++){
  const u=validAttachmentURL(url,hosts),r=await fetch(u,{redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(r.status>=300&&r.status<400){url=new URL(r.headers.get('location'),u).href;continue;}
  if(!r.ok)throw new Error('anexo_indisponivel');
  const bytes=await limitedBytes(r);return {bytes,mime:documentMime(bytes),hash:createHash('sha256').update(bytes).digest('hex')};
 }
 throw new Error('anexo_redirecionamentos_excessivos');
}
export async function archiveFile({folder,clientId,origin,name,bytes,mime,hash,token,beforeEffect}){
 // Reconcilia também um upload cujo recibo local não chegou a ser salvo.
 const prior=(await listFolder(folder,token)).find(f=>f.appProperties?.integral_client_id===clientId&&(f.appProperties?.integral_origin===origin||f.appProperties?.integral_sha256===hash));
 if(prior){if(prior.md5Checksum!==createHash('md5').update(bytes).digest('hex'))throw new Error('drive_reconciliacao_divergente');return prior;}
 if(token==='google-script'){
  await beforeEffect();const f=await scriptOperation('upload',{folder,clientId,origin,name,base64:bytes.toString('base64'),mime,hash});
  const check=await driveRequest('files/'+encodeURIComponent(f.id)+'?supportsAllDrives=true&fields=id,name,parents,md5Checksum',token);
  if(!check.parents?.includes(folder)||check.md5Checksum!==createHash('md5').update(bytes).digest('hex'))throw new Error('drive_recibo_nao_confirmado');return check;
 }
 const boundary='integral-'+randomUUID();
 const metadata={name:String(name||'documento').replace(/[\r\n\u0000]/g,'').slice(0,180),parents:[folder],appProperties:{integral_client_id:clientId,integral_origin:origin,integral_sha256:hash}};
 const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n'+JSON.stringify(metadata)+'\r\n--'+boundary+'\r\nContent-Type: '+mime+'\r\n\r\n'),bytes,Buffer.from('\r\n--'+boundary+'--\r\n')]);
 await beforeEffect();
 const r=await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,parents,md5Checksum',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'multipart/related; boundary='+boundary},body,signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error('drive_upload_'+r.status);
 const f=await r.json(),check=await driveRequest('files/'+encodeURIComponent(f.id)+'?supportsAllDrives=true&fields=id,name,parents,md5Checksum',token);
 if(!check.parents?.includes(folder)||check.md5Checksum!==createHash('md5').update(bytes).digest('hex'))throw new Error('drive_recibo_nao_confirmado');
 return check;
}
