import {getConversation,getConversationMessages,sendMessage,updateConversationAttributes} from './chatwoot.js';
import {getScheduleState} from './businessHours.js';
import {incoming,humanSince,timestamp} from './conversation-control.js';
export function waitingNotice(conversation,messages,now=new Date(),schedule=getScheduleState(now)){
 const a=conversation.custom_attributes||{},since=timestamp(a.ia_resolvido_em);
 if(conversation.status!=='open'||!(a.ia_etapa==='encaminhado'||a.ia_atendimento_concluido===true)||!(conversation.meta?.team?.id||conversation.team?.id||conversation.meta?.assignee?.id||conversation.assignee?.id))return null;
 if(humanSince(messages,since))return null;
 const pending=messages.filter(m=>incoming(m)&&!m.private&&timestamp(m.created_at)>since).sort((a,b)=>timestamp(a.created_at)-timestamp(b.created_at))[0];
 const start=timestamp(a.ia_encaminhado_em)||timestamp(pending?.created_at);
 if(!start||now.getTime()-start<30*60000)return null;
 if(schedule.open){
  if(now.getTime()-timestamp(a.ia_ultima_cutucada_em)<2*3600000)return null;
  return {action:'nudge',text:'Seu atendimento continua aguardando a equipe. Pedimos desculpas pela espera. As informações que você enviou estão registradas nesta conversa; não é necessário repeti-las.',patch:{ia_ultima_cutucada_em:now.toISOString()}};
 }
 if(schedule.justClosed&&a.ia_fim_expediente_avisado_em!==schedule.dateKey)return {action:'end_of_day',text:'Nosso horário de atendimento de hoje terminou. Sua solicitação permanece registrada para a equipe dar continuidade no próximo período de atendimento. Pedimos desculpas pela espera.',patch:{ia_fim_expediente_avisado_em:schedule.dateKey}};
 return null;
}
export async function processWaitingNotice(id,now=new Date()){
 if(process.env.AI_ENABLED==='false')return {ignored:true,reason:'ai_disabled'};
 const conversation=await getConversation(id),history=await getConversationMessages(id);
 const messages=Array.isArray(history?.payload)?history.payload:Array.isArray(history)?history:[];
 const notice=waitingNotice(conversation,messages,now);if(!notice)return null;
 await sendMessage(id,notice.text);await updateConversationAttributes(id,notice.patch);
 return {id,action:notice.action};
}
