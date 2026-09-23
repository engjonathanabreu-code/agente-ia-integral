import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import plain from '../api/webhook.js';
import token from '../api/webhook/[token].js';
process.env.CHATWOOT_BASE_URL='https://chat.example.invalid';process.env.CHATWOOT_ACCOUNT_ID='1';process.env.ERP_SUPABASE_SERVICE_ROLE_KEY='fixture';process.env.INTEGRACAO_ENABLED='true';process.env.WEBHOOK_TOKEN='fixture-token';process.env.CHATWOOT_API_TOKEN='test';process.env.OPENAI_API_KEY='test';
let db,original,archived=[],attrs={},messages=[],sent=[],identities=[],takeover=false;
const response=data=>new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
before(async()=>{
 db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create table processos_kanban(id uuid primary key);create table integracao_nucleo_ia(id uuid primary key,instrucao text,habilitado boolean);');
 await db.exec(await readFile(new URL('../supabase/migrations/20260923122036_chatwoot_fluxo_confiavel.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20260923123546_chatwoot_exigir_reserva_ativa.sql',import.meta.url),'utf8'));
 original=global.fetch;
 global.fetch=async(url,o={})=>{
  const body=o.body?JSON.parse(o.body):{};url=typeof url==='string'?url:url.url;
  if(url.endsWith('/rpc/integracao_ia_controle'))return response((await db.query('select integracao_ia_controle($1,$2) r',[body.operacao,JSON.stringify(body.dados)])).rows[0].r);
  if(url.endsWith('/rpc/integracao_ia_municipios'))return response(['Taió']);
  if(url.endsWith('/rpc/integracao_crm_receber')){archived.push(body.evento);return response('uuid');}
  if(url.endsWith('/rpc/integracao_crm_identificar')){identities.push(body);return response({confirmado:true});}
  if(url.includes('api.openai.com')){
   if(takeover) messages.push({id:900,message_type:1,sender:{type:'user'},created_at:Date.now()/1000,content:'Humano assumiu'});
   return response({id:'resp-test',output_text:JSON.stringify({nome:'Pessoa Teste',cidade:'Taió',documento:'',pede_andamento:false}),output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({nome:'Pessoa Teste',cidade:'Taió',documento:'',pede_andamento:false})}]}]});
  }
  if(url.endsWith('/custom_attributes')){attrs={...body.custom_attributes};return response({custom_attributes:attrs});}
  if(url.endsWith('/messages')){
   if(o.method==='POST'){sent.push(body);return response({id:800,...body});}
   return response({payload:messages});
  }
  if(/conversations\/\d+$/.test(url))return response({id:2,status:'open',custom_attributes:attrs,messages});
  throw Error(`UNEXPECTED REQUEST ${new URL(url).pathname}`);
 };
});
after(async()=>{global.fetch=original;await db.close();});
const base={event:'message_created',account:{id:1},conversation:{id:2,meta:{sender:{id:3,name:'Cliente'}}},sender:{type:'user',id:4,name:'Equipe'},message_type:'outgoing',content:'Olá',created_at:1789822800};
const call=async(handler,body,query={token:'fixture-token'})=>{const res={setHeader(){},end(v){this.body=JSON.parse(v);}};await handler({method:'POST',query,body},res);return res;};
test('as duas URLs usam o mesmo processador e preservam autenticação',async()=>{
 assert.equal(plain,token);
 assert.equal((await call(plain,base,{token:'wrong'})).statusCode,401);
 assert.equal((await call(plain,{...base,account:{id:99}})).statusCode,400);
 assert.equal(archived.length,0);
});
test('arquiva saídas e notas mesmo com IA pausada; duplicação entre rotas é ignorada',async()=>{
 for(const enabled of ['true','false']){
  process.env.AI_ENABLED=enabled;const p={...base,id:enabled==='true'?1:2,private:true};
  assert.equal((await call(plain,p)).statusCode,200);
  const retry=await call(token,p);assert.equal(retry.body.reason,'duplicate_event');
 }assert.equal(archived.length,2);assert.equal(archived[0].privada,true);assert.equal(sent.length,0);
});
test('nome/cidade rápidos em instâncias concorrentes geram uma resposta e dois originais',async()=>{
 process.env.AI_ENABLED='true';archived=[];sent=[];attrs={};messages=[];
 const p={...base,conversation:{...base.conversation,id:8},sender:{type:'contact'},message_type:'incoming',created_at:Date.now()/1000};
 const results=await Promise.all([call(plain,{...p,id:21,content:'Pessoa Teste'}),call(token,{...p,id:22,content:'Taió',created_at:p.created_at+0.05})]);
 // A concurrent request can be retried while the first worker drains its batch.
 assert.ok(results.some(r=>r.statusCode===200));
 assert.equal(sent.length,1);assert.equal(attrs.ia_nome,'Pessoa Teste');assert.equal(attrs.ia_cidade,'Taió');
 assert.deepEqual(archived.map(m=>m.conteudo),['Pessoa Teste','Taió']);
 assert.equal((await call(plain,{...p,id:22,content:'Taió',created_at:p.created_at+0.05})).statusCode,200);
 assert.equal(sent.length,1);
});
test('humano durante geração cancela resposta antes do envio',async()=>{
 sent=[];attrs={};messages=[];takeover=true;
 const p={...base,id:31,conversation:{...base.conversation,id:9},sender:{type:'contact'},message_type:'incoming',content:'Pessoa Teste de Taió',created_at:Date.now()/1000};
 assert.equal((await call(plain,p)).statusCode,200);assert.equal(sent.length,0);takeover=false;
});
test('evento conversation_created tardio não apaga identidade nem reativa IA',async()=>{
 attrs={ia_nome:'Pessoa Teste',ia_cidade:'Taió',ia_atendimento_concluido:true};
 await call(token,{event:'conversation_created',id:8,account:{id:1},meta:{sender:{id:3}}});
 assert.equal(attrs.ia_nome,'Pessoa Teste');assert.equal(attrs.ia_atendimento_concluido,true);
});
test('resposta a template mantém atribuição humana e não reinicia identificação',async()=>{
 sent=[];attrs={};messages=[{id:50,message_type:3,sender:{id:77,type:'user'},created_at:100,content:'Template'}];
 const priorFetch=global.fetch;let owner;
 global.fetch=async(url,o={})=>String(url).endsWith('/assignments')?(owner=JSON.parse(o.body).assignee_id,response({id:owner})):priorFetch(url,o);
 try {
  const p={...base,id:51,conversation:{...base.conversation,id:10},sender:{type:'contact'},message_type:'incoming',content:'Sim',created_at:101};
  assert.equal((await call(token,p)).statusCode,200);assert.equal(owner,77);assert.equal(sent.length,0);assert.equal(attrs.ia_atendimento_concluido,true);
 }finally{global.fetch=priorFetch;}
});
