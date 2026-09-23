import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import handler,{scanWaiting} from '../api/nudge-check.js';
process.env.CHATWOOT_BASE_URL='https://chat.example.invalid';process.env.CHATWOOT_ACCOUNT_ID='1';process.env.CHATWOOT_API_TOKEN='fixture';process.env.ERP_SUPABASE_SERVICE_ROLE_KEY='fixture';
const original=global.fetch;after(()=>{global.fetch=original;});
const response=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
test('varredura percorre além da décima página e enfileira sem enviar diretamente',async()=>{
 const enqueued=[];let cursor={pagina:1,indice:0};
 global.fetch=async(url,o={})=>{const u=new URL(url),b=o.body?JSON.parse(o.body):{};
  if(u.pathname.endsWith('/integracao_ia_agenda')){if(b.proxima_pagina!==null)cursor={pagina:b.proxima_pagina,indice:b.proximo_indice||0};return response(cursor);}
  if(u.pathname.endsWith('/integracao_ia_controle')){if(b.operacao==='enqueue')enqueued.push(b.dados);return response({});}
  if(u.pathname.endsWith('/conversations')){const page=Number(u.searchParams.get('page'));return response({data:{payload:page<=12?[{id:page,custom_attributes:{ia_etapa:'encaminhado'}}]:[]}});}
  throw Error('unexpected');
 };
 const r=await scanWaiting(new Date('2026-09-25T15:00:00Z'));
 assert.equal(r.scanned,12);assert.equal(enqueued.length,12);assert.equal(cursor.pagina,1);
 assert.ok(enqueued.every(e=>e.payload.event==='integral_wait_check'));assert.ok(enqueued.every(e=>Number.isInteger(e.at)));
});
test('varredura retoma no índice salvo, sem ignorar o restante da página',async()=>{
 const ids=[];let cursor={pagina:3,indice:1};
 global.fetch=async(url,o={})=>{const u=new URL(url),b=o.body?JSON.parse(o.body):{};
  if(u.pathname.endsWith('/integracao_ia_agenda')){if(b.proxima_pagina!==null)cursor={pagina:b.proxima_pagina,indice:b.proximo_indice||0};return response(cursor);}
  if(u.pathname.endsWith('/integracao_ia_controle')){if(b.operacao==='enqueue')ids.push(b.dados.payload.conversation.id);return response({});}
  if(u.pathname.endsWith('/conversations'))return response({payload:u.searchParams.get('page')==='3'?[10,11,12].map(id=>({id,custom_attributes:{ia_etapa:'encaminhado'}})):[]});
  throw Error('unexpected');
 };
 await scanWaiting();assert.deepEqual(ids,[11,12]);assert.equal(cursor.pagina,1);
});
test('rotina exige autenticação e respeita IA desligada sem acessar serviços',async()=>{
 global.fetch=async()=>{throw Error('não deve acessar');};process.env.NUDGE_CRON_TOKEN='fixture';process.env.AI_ENABLED='false';
 const call=async(token)=>{const res={setHeader(){},end(s){this.body=JSON.parse(s);}};await handler({method:'GET',query:{token}},res);return res;};
 assert.equal((await call('wrong')).statusCode,401);assert.equal((await call('fixture')).body.ignored,true);
});
