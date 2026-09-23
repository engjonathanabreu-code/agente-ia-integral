import {syncIntegration,account} from './integracao.js';
import {handleIncomingMessage,handleConversationStatusChanged} from './agent.js';
import {handleAgentPresentation,resetAgentPresentation} from './presentation.js';
import {getConversation,updateConversationAttributes} from './chatwoot.js';
import {routeTemplateReplyToHuman} from './template-reply.js';
import {execution,control,incoming,humanMessage,eventKey,conversationKey,timestamp} from './conversation-control.js';
const respond=(res,status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(body));};
export async function processEvent(p) {
  if(!p._archived) await syncIntegration(p);
  if(process.env.AI_ENABLED==='false') return {ignored:true,reason:'ai_disabled'};
  const id=p.conversation?.id||p.id;
  if(p.event==='conversation_created') return {ignored:true,reason:'initial_state_is_lazy'};
  if(p.event==='conversation_updated') return handleAgentPresentation(p);
  if(p.event==='conversation_status_changed') {
    // Ignore delayed status events: the current Chatwoot state is authoritative.
    const live=await getConversation(id);
    if(live.status!=='resolved'||(p.conversation?.status||p.status)!=='resolved') return {ignored:true,reason:'stale_status_event'};
    const resolvedAt=timestamp(p.updated_at||p.conversation?.updated_at)||timestamp(live.updated_at)||Date.now();
    const result=await handleConversationStatusChanged({...p,_resolvedAt:resolvedAt});
    await resetAgentPresentation(p);
    await control('resolved',{at:resolvedAt});
    return result;
  }
  if(!incoming(p)) return {ignored:true,reason:'not_incoming'};
  if(p.private===true) return {ignored:true,reason:'private_message'};
  // A human template reply must keep its original agent even when AI is paused.
  // This narrowly scoped operation only assigns/marks state; it never sends text.
  const template=await execution.run({...execution.getStore(),customerTurn:false},async()=>{
    const routed=await routeTemplateReplyToHuman(p);
    if(routed) {
      const live=await getConversation(id);
      await updateConversationAttributes(id,{...live.custom_attributes,ia_atendimento_concluido:true,ia_etapa:'encaminhado'});
    }
    return routed;
  });
  if(template) return template;
  const state=await control('guard');
  if(state.human) return {ignored:true,reason:'human_handoff_active'};
  return handleIncomingMessage(p);
}
export default async function handler(req,res) {
  if(req.method==='GET') return respond(res,200,{ok:true,service:'Agente IA Integral',enabled:process.env.AI_ENABLED!=='false',coordination:'persistent-v1'});
  if(req.method!=='POST') return respond(res,405,{error:'Method not allowed'});
  const provided=String(req.query?.token||req.headers?.['x-webhook-token']||'');
  if(!process.env.WEBHOOK_TOKEN||provided!==process.env.WEBHOOK_TOKEN) return respond(res,401,{error:'Webhook não autorizado.'});
  const p=req.body;
  if(!p) return respond(res,200,{ok:true,ignored:true,reason:'empty_payload'});
  if(!['message_created','conversation_created','conversation_updated','conversation_status_changed'].includes(p.event)) return respond(res,200,{ok:true,ignored:true,reason:'event_not_supported'});
  const id=p.conversation?.id||p.id;
  if(!/^\d+$/.test(String(id))||String(p.account?.id||p.conversation?.account_id)!==account()) return respond(res,400,{ok:false,error:'Evento inválido para esta conta.'});
  const ctx={key:conversationKey(id)};
  try {
    const registered=await control('enqueue',{event_key:eventKey(p),payload:p,human:p.event==='message_created'&&humanMessage(p),at:timestamp(p.event==='message_created'?p.created_at:(p.updated_at||p.conversation?.updated_at||p.created_at))||Date.now()},ctx);
    if(registered.done) return respond(res,200,{ok:true,ignored:true,reason:'duplicate_event'});
    // Small collection window lets the database order fragments before extraction.
    if(p.event==='message_created'&&incoming(p)) await new Promise(r=>setTimeout(r,1200));
    const started=Date.now();let result;
    while(Date.now()-started<40000) {
      const job=await control('claim',{},ctx);
      if(!job.token) break;
      const run={...ctx,token:job.token,eventKey:job.event_key,customerTurn:(job.payload.event==='message_created'&&incoming(job.payload))||job.payload.event==='conversation_updated',effects:false};
      try {
        result=await execution.run(run,async()=>{
          // Archive each original independently; a batch must not rewrite history.
          for(const original of job.originals||[job.payload]) await syncIntegration(original);
          return processEvent({...job.payload,_archived:true});
        });
        await control('finish',{status:'done'},run);
      } catch(e) {
        const stopped=e.message==='human_takeover';
        await control('finish',{status:stopped?'done':run.effects?'review':'pending',error:stopped?'human_takeover':e.message},run);
        if(!stopped) throw e;
        result={ignored:true,reason:'human_takeover'};
      }
    }
    const own=await control('status',{event_key:eventKey(p)},ctx);
    if(['done','review'].includes(own.status)) return respond(res,200,{ok:true,result,review:own.status==='review'});
    res.setHeader('Retry-After','5');
    return respond(res,503,{ok:false,error:'Mensagem registrada e aguardando processamento.'});
  } catch(e) {
    console.error('chatwoot-processing',{code:e.message,key:id});
    return respond(res,503,{ok:false,error:'Atendimento registrado para nova tentativa ou revisão.'});
  }
}
