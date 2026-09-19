import {test} from 'node:test';
import assert from 'node:assert/strict';
import {integrationEvent,syncIntegration,progressIntegration} from '../lib/integracao.js';
process.env.CHATWOOT_BASE_URL='https://chat.example.invalid';process.env.CHATWOOT_ACCOUNT_ID='1';
process.env.ERP_SUPABASE_SERVICE_ROLE_KEY='fixture';process.env.INTEGRACAO_ENABLED='true';
const payload={event:'message_created',id:8,account:{id:1},conversation:{id:2,meta:{sender:{id:3,name:'Morador',phone_number:'+5547999990000'},assignee:{id:5}}},sender:{id:6,name:'Equipe',type:'user'},private:true,message_type:'outgoing',content:'Registro interno',created_at:1789822800};
test('arquiva respostas e notas com identidade do contato, não do agente; rejeita outra conta',()=>{
 const e=integrationEvent(payload);assert.equal(e.contato_id,'3');assert.equal(e.autor,'Equipe');assert.equal(e.privada,true);assert.equal(e.agente_id,'5');
 assert.throws(()=>integrationEvent({...payload,account:{id:9}}),/account_mismatch/);
 assert.equal(integrationEvent({event:'typing_on'}),null);
});
test('ponte aguarda persistência e consulta somente contexto confirmado',async()=>{
 const original=global.fetch,calls=[];
 global.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>url.endsWith('receber')?'uuid':url.endsWith('identificar')?{confirmado:false,pergunta:'Confira os dados'}:{}};};
 try {await syncIntegration(payload);const r=await progressIntegration(2,{ia_nome:'José',ia_cidade:'Taió'});assert.equal(r.identity_pending,true);assert.equal(calls.length,2);assert.ok(!calls.some(c=>c.url.includes('contexto')));}finally{global.fetch=original;}
});
test('erro de banco não confirma recebimento do webhook',async()=>{
 const original=global.fetch;global.fetch=async()=>({ok:false,status:503});
 try{await assert.rejects(syncIntegration(payload),/database_503/);}finally{global.fetch=original;}
});
