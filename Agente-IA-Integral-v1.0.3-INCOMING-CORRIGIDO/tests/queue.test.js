import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
let db;
before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.processos_kanban(id uuid primary key);
 create table public.integracao_nucleo_ia(id uuid primary key,instrucao text,habilitado boolean);`);
 await db.exec(await readFile(new URL('../supabase/migrations/20260923122036_chatwoot_fluxo_confiavel.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20260923123546_chatwoot_exigir_reserva_ativa.sql',import.meta.url),'utf8'));
});
after(()=>db.close());
const rpc=async(operacao,dados)=> (await db.query('select public.integracao_ia_controle($1,$2) result',[operacao,JSON.stringify(dados)])).rows[0].result;
const evt=(id,content='Olá',type='incoming')=>({event:'message_created',id,message_type:type,content,conversation:{id:1},created_at:id});
const add=(chave,id,content,type)=>rpc('enqueue',{chave,event_key:`message:${id}`,at:id*1000,payload:evt(id,content,type)});
test('ordena fora de ordem, agrupa fragmentos e mantém originais',async()=>{
 await add('order',3,'Taió');await add('order',2,'Pessoa Teste');await add('order',1,'Olá');
 const j=await rpc('claim',{chave:'order'});
 assert.equal(j.payload.content,'Olá\nPessoa Teste\nTaió');assert.equal(j.originals.length,3);
 assert.equal(j.event_key,'message:1');
 assert.deepEqual(await rpc('claim',{chave:'order'}),{});
 await rpc('finish',{chave:'order',token:j.token,status:'done'});
 assert.equal((await add('order',2,'Pessoa Teste')).done,true);
 assert.deepEqual(await rpc('claim',{chave:'order'}),{});
});
test('conversas independentes e exclusão mútua entre instâncias',async()=>{
 await add('a',10);await add('b',10);
 const [a,a2,b]=await Promise.all([rpc('claim',{chave:'a'}),rpc('claim',{chave:'a'}),rpc('claim',{chave:'b'})]);
 assert.ok(a.token);assert.deepEqual(a2,{});assert.ok(b.token);
 assert.equal((await rpc('guard',{chave:'a',token:b.token})).valid,false);
});
test('intervenção humana interrompe worker ativo; resolução permite novo atendimento',async()=>{
 await add('human',20);const j=await rpc('claim',{chave:'human'});
 await rpc('enqueue',{chave:'human',event_key:'message:21',at:21000,human:true,payload:evt(21,'Equipe','outgoing')});
 assert.equal((await rpc('guard',{chave:'human',token:j.token})).human,true);
 await rpc('resolved',{chave:'human',token:j.token,at:22000});
 assert.equal((await rpc('guard',{chave:'human',token:j.token})).human,false);
 // A delayed replay of the old human message must not pause a new session.
 await rpc('enqueue',{chave:'human',event_key:'message:21',at:21000,human:true,payload:evt(21,'Equipe','outgoing')});
 assert.equal((await rpc('guard',{chave:'human',token:j.token})).human,false);
});
test('crash sem efeitos é recuperado; envio incerto fica para revisão sem duplicar',async()=>{
 for(const effect of [false,true]){
  const chave=`crash-${effect}`;await add(chave,30);const j=await rpc('claim',{chave});
  if(effect) await rpc('effect',{chave,token:j.token});
  await db.query("update public.integracao_ia_sessoes set lease_until=now()-interval '1 second' where chave=$1",[chave]);
  const retry=await rpc('claim',{chave});
  if(effect){assert.deepEqual(retry,{});assert.equal((await rpc('status',{chave,event_key:'message:30'})).status,'review');}
  else assert.ok(retry.token);
  assert.equal((await rpc('guard',{chave,token:j.token})).valid,false);
 }
});
test('anexos não são fundidos e notas privadas não viram texto público',async()=>{
 await rpc('enqueue',{chave:'media',event_key:'message:40',at:40000,payload:{...evt(40),attachments:[{file_type:'image'}]}});
 await add('media',41,'texto');
 const j=await rpc('claim',{chave:'media'});assert.equal(j.originals.length,1);assert.equal(j.payload.attachments.length,1);
});
test('anon e authenticated não acessam fila nem RPC; service_role pode usar',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query('select * from public.integracao_ia_eventos'),/permission denied/);
  await assert.rejects(rpc('status',{chave:'a',event_key:'message:10'}),/permission denied/);
  await db.exec('reset role');
 }
 await db.exec('set role service_role');assert.equal((await rpc('status',{chave:'order',event_key:'message:1'})).status,'done');await db.exec('reset role');
});
test('attachments null não interrompe a fila',async()=>{
 await rpc('enqueue',{chave:'null-attachments',event_key:'message:99',at:99000,payload:{...evt(99),attachments:null}});
 assert.ok((await rpc('claim',{chave:'null-attachments'})).token);
});
test('sessão ociosa nunca autoriza worker sem token',async()=>{
 await add('idle',100);assert.equal((await rpc('guard',{chave:'idle'})).valid,false);
 await assert.rejects(rpc('effect',{chave:'idle'}),/conversation_lease_lost/);
});
