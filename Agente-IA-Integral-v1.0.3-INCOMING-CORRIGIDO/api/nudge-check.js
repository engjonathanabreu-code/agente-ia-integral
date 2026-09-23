import {integrationDB} from '../lib/integracao.js';
import {listConversations} from '../lib/chatwoot.js';
import {control,conversationKey} from '../lib/conversation-control.js';
import {drainConversation} from '../lib/webhook-handler.js';
const rows=v=>[v,v?.payload,v?.data?.payload].find(Array.isArray)||[];
export async function scanWaiting(now=new Date(),maxMs=45000){
 const start=Date.now(),seen=new Set(),results=[];const cursor=await integrationDB('rpc/integracao_ia_agenda',{proxima_pagina:null});let page=cursor.pagina,offset=cursor.indice;
 while(Date.now()-start<maxMs){
  const list=rows(await listConversations({status:'open',page}));if(!list.length){page=1;break;}
  let newRows=0;
  for(let index=offset;index<list.length;index++){
   const c=list[index];
   if(seen.has(c.id))continue;seen.add(c.id);newRows++;
   const a=c.custom_attributes||{};if(!a.ia_atendimento_concluido&&a.ia_etapa!=='encaminhado')continue;
   const ctx={key:conversationKey(c.id)},key=`wait:${Math.floor(now.getTime()/600000)}`;
   await control('enqueue',{event_key:key,at:now.getTime(),payload:{event:'integral_wait_check',conversation:{id:c.id}}},ctx);
   if(Date.now()-start>=maxMs){await integrationDB('rpc/integracao_ia_agenda',{proxima_pagina:page,proximo_indice:index});return {scanned:seen.size,results,incomplete:true,nextPage:page};}
   results.push(await drainConversation(ctx,Math.max(1,maxMs-(Date.now()-start))));
  }
  if(!newRows&&offset===0){page=1;break;}page++;offset=0;
 }
 await integrationDB('rpc/integracao_ia_agenda',{proxima_pagina:page});
 return {scanned:seen.size,results,incomplete:Date.now()-start>=maxMs,nextPage:page};
}
export default async function handler(req,res){
 const json=(status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
 if(!['GET','POST'].includes(req.method))return json(405,{ok:false});
 const provided=req.query?.token||req.headers?.['x-nudge-token'];
 const bearer=String(req.headers?.authorization||'').replace(/^Bearer /,'');
 if(!(process.env.NUDGE_CRON_TOKEN&&provided===process.env.NUDGE_CRON_TOKEN)&&!(process.env.CRON_SECRET&&bearer===process.env.CRON_SECRET))return json(401,{ok:false,error:'Não autorizado.'});
 if(process.env.AI_ENABLED==='false')return json(200,{ok:true,ignored:true,reason:'ai_disabled'});
 try{return json(200,{ok:true,...await scanWaiting()});}catch(e){console.error('wait_notices',{code:e.message});return json(503,{ok:false,error:'Não foi possível verificar os avisos agora.'});}
}
