import {timingSafeEqual} from 'node:crypto';
import {refreshDocumentalReadiness} from '../lib/documental.js';
import {integrationDB,account} from '../lib/integracao.js';
import {control,conversationKey} from '../lib/conversation-control.js';
import {drainConversation} from '../lib/webhook-handler.js';
export const config={maxDuration:180};
export function cronAuthorized(req){const expected=process.env.CRON_SECRET,provided=String(req.headers?.authorization||'');if(!expected)return false;const a=Buffer.from('Bearer '+expected),b=Buffer.from(provided);return a.length===b.length&&timingSafeEqual(a,b);}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Use GET.'});
 if(!cronAuthorized(req))return res.status(401).json({error:'Não autorizado.'});
 try{
  const state=await refreshDocumentalReadiness();
  if(!state.pronto||!state.ativo||process.env.AI_ENABLED==='false')return res.status(200).json({ok:true,...state,processados:0});
  const candidates=await integrationDB('rpc/integracao_documental_candidatos',{});
  let processados=0;const started=Date.now();
  for(const row of candidates){
   if(Date.now()-started>100000)break;
   const ctx={key:conversationKey(row.conversa_id)},bucket=Math.floor(Date.now()/600000);
   await control('enqueue',{event_key:`documental:${row.conversa_id}:${bucket}`,payload:{event:'integral_documental_check',conversation:{id:row.conversa_id},account:{id:account()}},human:false,at:Date.now()},ctx);
   await drainConversation(ctx,30000);processados++;
  }
  return res.status(200).json({ok:true,processados});
 }catch{console.error('documental-check',{code:'check_failed'});return res.status(503).json({error:'Verificação documental indisponível.'});}
}
