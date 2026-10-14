import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {scriptURL,scriptReadOperation,scriptOperation} from '../lib/documental-script.js';
import {archiveFile} from '../lib/documental-drive.js';
const secret='a'.repeat(64),root='1ZgjCZPG5Xl1ZyZofu1EmSDCzWqneVsnE',folder='folder_inside_123',outside='folder_outside_123',fileId='document_test_123';
const source=readFileSync(new URL('../google-drive-service/Code.gs',import.meta.url),'utf8');
const hash=(bytes,algo='sha256')=>createHash(algo).update(Buffer.from(bytes)).digest('hex');
function service(){
 const files=new Map([[root,{id:root,mimeType:'application/vnd.google-apps.folder',parents:[],capabilities:{canAddChildren:true}}],[folder,{id:folder,mimeType:'application/vnd.google-apps.folder',parents:[root],capabilities:{canAddChildren:true}}],[outside,{id:outside,mimeType:'application/vnd.google-apps.folder',parents:[],capabilities:{canAddChildren:true}}]]);
 const effects={create:0,download:0,metadata:0};let stored=[];
 const context=vm.createContext({
  ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
  PropertiesService:{getScriptProperties:()=>({getProperty:()=>secret})},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256',MD5:'md5'},computeDigest:(alg,data)=>Array.from(createHash(alg).update(Buffer.from(data)).digest()),base64Decode:s=>Array.from(Buffer.from(s,'base64')),base64Encode:bytes=>Buffer.from(bytes).toString('base64'),newBlob:(bytes,mime,name)=>({bytes,mime,name})},
  Drive:{Files:{get:id=>{effects.metadata++;if(!files.has(id))throw new Error('not found');return files.get(id);},list:p=>({files:p.q.includes('appProperties')?stored:stored}),create:(meta,blob)=>{effects.create++;const file={...meta,id:fileId,size:blob.bytes.length,md5Checksum:hash(blob.bytes,'md5')};files.set(fileId,file);stored.push(file);return file;}}},
  ScriptApp:{getOAuthToken:()=> 'google-token-not-exported'},
  UrlFetchApp:{fetch:()=>{effects.download++;throw new Error('unexpected download');}},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})}
 });vm.runInContext(source,context);
 return {context,files,effects,post:p=>JSON.parse(context.doPost({postData:{contents:JSON.stringify(p)}}).text)};
}
test('script recusa chamadas sem chave antes de acessar o Drive',()=>{
 const s=service();assert.equal(JSON.parse(s.context.doGet().text).ok,false);assert.equal(s.post({key:'b'.repeat(64),op:'meta',id:root}).ok,false);assert.equal(s.effects.metadata,0);assert.equal(s.post({key:secret,op:'delete',id:root}).ok,false);assert.equal(s.effects.metadata,0);
});
test('script limita metadados e downloads à árvore de Guaratuba',()=>{
 const s=service();assert.equal(s.post({key:secret,op:'meta',id:folder}).data.id,folder);assert.equal(s.post({key:secret,op:'meta',id:outside}).ok,false);assert.equal(s.post({key:secret,op:'download',id:outside}).ok,false);assert.equal(s.effects.download,0);
 s.files.set('cycle_folder_123',{id:'cycle_folder_123',parents:['cycle_folder_123']});assert.equal(s.post({key:secret,op:'meta',id:'cycle_folder_123'}).ok,false);
});
test('download permitido usa o token apenas no Google e impede arquivo excessivo',()=>{
 const s=service(),bytes=Buffer.from('%PDF-test');let calls=0;
 s.files.set(fileId,{id:fileId,mimeType:'application/pdf',parents:[folder],size:bytes.length});
 s.context.UrlFetchApp.fetch=(url,options)=>{calls++;assert.equal(new URL(url).hostname,'www.googleapis.com');assert.equal(options.followRedirects,false);return {getResponseCode:()=>200,getBlob:()=>({getBytes:()=>Array.from(bytes)})};};
 const result=s.post({key:secret,op:'download',id:fileId});assert.equal(Buffer.from(result.data.base64,'base64').toString(),bytes.toString());assert.ok(!JSON.stringify(result).includes('google-token'));assert.equal(calls,1);
 s.files.get(fileId).size=21*1024*1024;assert.equal(s.post({key:secret,op:'download',id:fileId}).ok,false);assert.equal(calls,1);
});
test('script valida conteúdo, mantém original e deduplica upload com recibo',()=>{
 const s=service(),bytes=Buffer.from('%PDF-test');const p={key:secret,op:'upload',folder,clientId:'00000000-0000-4000-8000-000000000001',origin:'1:9:5:8',name:'ficticio.pdf',mime:'application/pdf',hash:hash(bytes),base64:bytes.toString('base64')};
 assert.equal(s.post({...p,folder:root}).ok,false);assert.equal(s.post({...p,folder:outside}).ok,false);assert.equal(s.post({...p,mime:'image/jpeg'}).ok,false);assert.equal(s.effects.create,0);
 assert.equal(s.post(p).data.id,fileId);assert.equal(s.post(p).data.id,fileId);assert.equal(s.effects.create,1);
 s.files.get(fileId).md5Checksum='receipt-conflict';assert.equal(s.post(p).ok,false);assert.equal(s.effects.create,1);
});
test('adaptador aceita apenas endpoint Google e consultas fixas de pasta',()=>{
 assert.throws(()=>scriptURL('https://externo.test/macros/s/'+'a'.repeat(30)+'/exec'),/url_invalida/);
 assert.throws(()=>scriptURL('https://script.google.com/macros/s/'+'a'.repeat(30)+'/exec?key=x'),/url_invalida/);
 const q=new URLSearchParams({q:"'"+folder+"' in parents and trashed = false"});assert.equal(scriptReadOperation('files?'+q).data.folder,folder);
 assert.throws(()=>scriptReadOperation('files?q='+encodeURIComponent('trashed = false')),/consulta_invalida/);assert.throws(()=>scriptReadOperation('https://externo.test/files'),/operacao_invalida/);
});
async function withConfig(fn){const keys=['GOOGLE_DRIVE_SCRIPT_URL','GOOGLE_DRIVE_SCRIPT_SECRET'],before=keys.map(k=>process.env[k]);const fetch=global.fetch;process.env[keys[0]]='https://script.google.com/macros/s/'+'a'.repeat(30)+'/exec';process.env[keys[1]]=secret;try{await fn();}finally{global.fetch=fetch;keys.forEach((k,i)=>before[i]===undefined?delete process.env[k]:process.env[k]=before[i]);}}
test('redirecionamento não transmite chave nem documento fora do script',async()=>withConfig(async()=>{
 const calls=[];global.fetch=async(url,options)=>{calls.push({url:String(url),options});return calls.length===1?new Response(null,{status:302,headers:{Location:'https://script.googleusercontent.com/result'}}):new Response(JSON.stringify({ok:true,data:{id:root}}));};
 assert.equal((await scriptOperation('meta',{id:root})).id,root);assert.equal(calls[1].options.method,'GET');assert.equal(calls[1].options.body,undefined);assert.equal(calls[1].options.headers,undefined);
 let count=0;global.fetch=async()=>{count++;return new Response(null,{status:302,headers:{Location:'https://externo.test/leak'}});};await assert.rejects(scriptOperation('meta',{id:root}),/redirecionamento_recusado/);assert.equal(count,1);
}));
test('arquivo recebido passa pelo adaptador e confirma checksum e pasta',async()=>withConfig(async()=>{
 const s=service();global.fetch=async(url,options)=>new Response(JSON.stringify(s.post(JSON.parse(options.body))));
 const bytes=Buffer.from('%PDF-test');let effects=0;const args={folder,clientId:'00000000-0000-4000-8000-000000000001',origin:'1:9:5:8',name:'ficticio.pdf',bytes,mime:'application/pdf',hash:hash(bytes),token:'google-script',beforeEffect:async()=>effects++};
 const stored=await archiveFile(args);assert.equal(stored.id,fileId);assert.equal(stored.md5Checksum,hash(bytes,'md5'));assert.deepEqual(stored.parents,[folder]);await archiveFile(args);assert.equal(effects,1);assert.equal(s.effects.create,1);
}));
test('adaptador recusa respostas maiores que o limite',async()=>withConfig(async()=>{
 global.fetch=async()=>new Response('{}',{headers:{'content-length':String(31*1024*1024)}});await assert.rejects(scriptOperation('meta',{id:root}),/resposta_excessiva/);
}));
