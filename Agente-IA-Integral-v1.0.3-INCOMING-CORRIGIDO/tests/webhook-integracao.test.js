import {test} from 'node:test';
import assert from 'node:assert/strict';
import plain from '../api/webhook.js';
import token from '../api/webhook/[token].js';
process.env.CHATWOOT_BASE_URL='https://chat.example.invalid';process.env.CHATWOOT_ACCOUNT_ID='1';process.env.ERP_SUPABASE_SERVICE_ROLE_KEY='fixture';process.env.INTEGRACAO_ENABLED='true';process.env.WEBHOOK_TOKEN='fixture-token';
const body={event:'message_created',id:9,account:{id:1},conversation:{id:2,meta:{sender:{id:3,name:'Cliente'}}},sender:{type:'user',id:4,name:'Equipe'},message_type:'outgoing',content:'Olá',created_at:1789822800};
const call=async(handler,query)=>{const res={setHeader(){},end(v){this.body=JSON.parse(v);}};await handler({method:'POST',query,body},res);return res;};
test('ambas as rotas arquivam antes do filtro incoming e da pausa da IA',async()=>{
 const previous=global.fetch;let writes=0;global.fetch=async()=>{writes++;return{ok:true,json:async()=> 'uuid'};};
 try {for(const handler of [plain,token]){
  process.env.AI_ENABLED='true';assert.equal((await call(handler,{token:'fixture-token'})).body.reason,'not_incoming');
  process.env.AI_ENABLED='false';assert.equal((await call(handler,{token:'fixture-token'})).body.reason,'ai_disabled');
  assert.equal((await call(handler,{token:'wrong'})).statusCode,401);
 }assert.equal(writes,4);}finally{global.fetch=previous;}
});
