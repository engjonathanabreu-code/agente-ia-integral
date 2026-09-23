import {test,after} from 'node:test';import assert from 'node:assert/strict';
import {collectIdentity} from '../lib/integracao-intake.js';
process.env.INTEGRACAO_ENABLED='true';process.env.OPENAI_API_KEY='fixture';process.env.CHATWOOT_BASE_URL='https://chat.invalid';process.env.CHATWOOT_ACCOUNT_ID='1';process.env.CHATWOOT_API_TOKEN='fixture';process.env.INTEGRACAO_SUPABASE_SECRET='fixture';
let attrs={},sent=[],output={},identity={},failModel=false,calls=[];const original=global.fetch;after(()=>global.fetch=original);
function setup(initial={}){
 attrs=initial;sent=[];calls=[];identity={confirmado:true};output={};failModel=false;
 global.fetch=async(url,o={})=>{
  url=String(url);const b=o.body?JSON.parse(o.body):{};calls.push(url);let r;
  if(url.includes('api.openai.com')){if(failModel)throw Error('offline');r={output_text:JSON.stringify(output),output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]};}
  else if(url.endsWith('integracao_ia_municipios'))r=['Taió','Rio do Sul'];
  else if(url.endsWith('integracao_crm_identificar'))r=identity;
  else if(url.endsWith('custom_attributes')){attrs=b.custom_attributes;r={};}
  else if(url.endsWith('messages')){if(o.method==='POST')sent.push(b.content);r={payload:[]};}
  else if(url.endsWith('conversations/1'))r={status:'open',custom_attributes:attrs};
  else throw Error('Unexpected offline request');return new Response(JSON.stringify(r),{status:200,headers:{'content-type':'application/json'}});
 };
}
test('mantém nome e pedido, pede só município, depois só CPF se necessário',async()=>{
 setup({ia_etapa:'identidade',ia_nome:'João Silva',ia_pede_andamento:true,ia_pedido_original:'Quero saber o andamento'});
 output={cidade:'Taió',nome:'',documento:'',pede_andamento:false};identity={confirmado:false,acao:'solicitar_documento',campos_faltantes:['documento']};
 await collectIdentity(1,'Taió/SC',attrs);assert.equal(attrs.ia_nome,'João Silva');assert.equal(attrs.ia_cidade,'Taió');assert.equal(attrs.ia_campo_pendente,'documento');assert.match(sent[0],/apenas o CPF/);
 output={documento:'52998224725'};identity={confirmado:true};const result=await collectIdentity(1,'529.982.247-25',attrs);
 assert.equal(result.ready,true);assert.equal(result.confirmed,true);assert.equal(result.originalNeed,'Quero saber o andamento');assert.equal(attrs.ia_identidade_confirmada,true);
});
test('não usa bairro como cidade; aceita município conhecido com UF e sem acento',async()=>{
 setup({ia_etapa:'identidade',ia_nome:'João Silva'});output={cidade:'Cohapar'};
 await collectIdentity(1,'Cohapar',attrs);assert.equal(attrs.ia_cidade,'');assert.equal(attrs.ia_nome,'João Silva');assert.match(sent[0],/sem o nome do bairro/);
 output={cidade:'Taio'};await collectIdentity(1,'Taio SC',attrs);assert.equal(attrs.ia_cidade,'Taió');
});
test('repete sem dado novo apenas até limite, depois preserva dados para revisão',async()=>{
 setup({ia_etapa:'identidade',ia_nome:'João Silva',ia_sem_dados_novos:2});output={};const r=await collectIdentity(1,'Já informei',attrs);assert.equal(r.review,true);assert.equal(r.attrs.ia_nome,'João Silva');
});
test('falha do modelo não pede nome já informado',async()=>{
 setup({ia_etapa:'identidade',ia_nome:'João Silva',ia_campo_pendente:'cidade'});failModel=true;
 await collectIdentity(1,'Taió',attrs);assert.match(sent[0],/município/);assert.doesNotMatch(sent[0],/nome completo|CPF/);
});
test('pedido não é perdido quando chega junto com identificação',async()=>{
 setup();output={nome:'João Silva',cidade:'Taió',documento:'',pede_andamento:false};const text='Sou João Silva de Taió e preciso de boleto';
 const r=await collectIdentity(1,text,attrs);assert.equal(r.originalNeed,text);assert.equal(r.ready,true);
});
test('representante vai para revisão sem confirmar o titular como interlocutor',async()=>{
 setup();output={nome:'Ana Maria',cidade:'Taió',representante:true};const r=await collectIdentity(1,'Sou neto de Ana Maria, de Taió',attrs);
 assert.equal(r.review,true);assert.equal(r.attrs.ia_representante,true);assert.ok(!calls.some(c=>c.endsWith('integracao_crm_identificar')));
});
